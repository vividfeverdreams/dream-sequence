import { db } from "@/lib/db";
import { assessSubmission } from "@/lib/ai-assessment";
import { checkSubmissionRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import { defaultNegativePrompt } from "@/lib/session-defaults";
import { hashValue, normalizePromptText } from "@/lib/utils";
import { reconcileRenderJob, startVideoRender } from "@/lib/rendering";

type IntakeInput = {
  sessionCode: string;
  source: "sms" | "web";
  prompt: string;
  sender?: string | null;
  senderFingerprintSeed: string;
  messageSid?: string | null;
};

export async function ingestSubmission(input: IntakeInput) {
  if (input.messageSid) {
    const existing = await db.promptSubmission.findUnique({
      where: {
        messageSid: input.messageSid
      }
    });

    if (existing) {
      return {
        status: "approved" as const,
        message: "That remix text is already in the mix.",
        submissionId: existing.id
      };
    }
  }

  const session = await db.dJSession.findUnique({
    where: {
      code: input.sessionCode
    },
    include: {
      playbackState: true,
      submissions: {
        where: {
          status: {
            in: ["approved", "ready", "live"]
          }
        },
        include: {
          rankingResult: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 8
      }
    }
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  if (session.status !== "live") {
    throw new Error("This session is not live yet.");
  }

  const senderFingerprint = hashValue(`${input.sessionCode}:${input.senderFingerprintSeed}`);
  const rateLimit = await checkSubmissionRateLimit(session.id, senderFingerprint);

  if (!rateLimit.allowed) {
    return {
      status: "rate-limited" as const,
      message: rateLimit.reason ?? "Please wait before sending another remix."
    };
  }

  const submission = await db.promptSubmission.create({
    data: {
      sessionId: session.id,
      source: input.source,
      sender: input.sender || null,
      senderFingerprint,
      messageSid: input.messageSid || null,
      rawText: input.prompt,
      normalizedText: normalizePromptText(input.prompt)
    }
  });

  const assessment = await assessSubmission({
    submissionText: submission.normalizedText,
    session,
    recentWinningPrompts: session.submissions
      .map((item: any) => item.rankingResult?.winningPrompt)
      .filter((value: any): value is string => Boolean(value))
  });

  await db.$transaction(async (tx: any) => {
    await tx.moderationResult.create({
      data: {
        submissionId: submission.id,
        decision: assessment.decision,
        score: assessment.score,
        flags: JSON.stringify(assessment.flags),
        explanation: assessment.explanation
      }
    });

    await tx.rankingResult.create({
      data: {
        submissionId: submission.id,
        score: assessment.score,
        noveltyScore: assessment.noveltyScore,
        cohesionScore: assessment.cohesionScore,
        remixDeltaScore: assessment.remixDeltaScore,
        winningPrompt: assessment.winningPrompt,
        explanation: assessment.approvalReason
      }
    });

    await tx.promptSubmission.update({
      where: {
        id: submission.id
      },
      data: {
        status: assessment.decision === "approved" ? "approved" : "rejected",
        approvalReason: assessment.approvalReason
      }
    });
  });

  await recordAuditEvent({
    type: assessment.decision === "approved" ? "submission.approved" : "submission.rejected",
    summary: `Processed ${input.source} submission`,
    details: assessment.explanation,
    sessionId: session.id
  });

  if (assessment.decision === "approved") {
    await attemptAutomatedSelection(session.id);
  }

  return {
    status: assessment.decision,
    message:
      assessment.decision === "approved"
        ? "Your remix is in the mix. Venue-safe AI is scoring the queue now."
        : "That idea did not pass the venue-safe remix filter.",
    submissionId: submission.id
  };
}

export async function attemptAutomatedSelection(sessionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      },
      submissions: {
        where: {
          status: "approved",
          selectedAt: null
        },
        include: {
          rankingResult: true
        }
      }
    }
  });

  if (!session?.playbackState) {
    return null;
  }

  if (!session.autoSelectEnabled || session.playbackState.emergencyPaused) {
    return null;
  }

  if (session.playbackState.nextAssetId || session.renderJobs.length > 0) {
    return null;
  }

  const nextSubmission = [...session.submissions]
    .filter((submission) => submission.rankingResult)
    .sort((left, right) => (right.rankingResult?.score ?? 0) - (left.rankingResult?.score ?? 0))[0];

  if (!nextSubmission?.rankingResult) {
    return null;
  }

  await db.promptSubmission.update({
    where: {
      id: nextSubmission.id
    },
    data: {
      status: "queued",
      selectedAt: new Date()
    }
  });

  return queueAutomatedRender(sessionId, nextSubmission.id, session.playbackState.currentAssetId ? "remix" : "seed", nextSubmission.rankingResult.winningPrompt);
}

export async function queueAutomatedRender(
  sessionId: string,
  submissionId: string | null,
  requestedMode: "seed" | "remix",
  promptText: string
) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      },
      visualAssets: {
        where: {
          status: "live"
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!session?.playbackState) {
    return null;
  }

  if (session.renderJobs.length > 0 || session.playbackState.nextAssetId) {
    return null;
  }

  const sourceAsset = session.visualAssets[0] ?? null;
  const canEditExistingVideo =
    requestedMode === "remix" &&
    Boolean(sourceAsset?.sourceVideoId) &&
    String(sourceAsset?.sourceVideoId).startsWith("video_");
  const mode = canEditExistingVideo ? "remix" : "seed";
  const renderPrompt = addNegativeConstraints(promptText, String(session.negativePrompt || defaultNegativePrompt));

  const outputAsset = await db.visualAsset.create({
    data: {
      sessionId,
      sourceSubmissionId: submissionId,
      kind: mode,
      title: mode === "seed" ? "Seed Loop" : "Crowd Remix",
      promptText: renderPrompt,
      status: "processing"
    }
  });

  const renderJob = await db.renderJob.create({
    data: {
      sessionId,
      submissionId,
      sourceAssetId: sourceAsset?.id ?? null,
      outputAssetId: outputAsset.id,
      mode,
      status: "queued",
      promptText: renderPrompt
    }
  });

  const openAiApiKey = session.userId
    ? await getEffectiveOpenAiApiKeyForUser(String(session.userId))
    : null;

  let started;

  try {
    started = await startVideoRender({
      mode,
      prompt: renderPrompt,
      sourceVideoId: sourceAsset?.sourceVideoId,
      imageReferenceUrl: session.imageReferenceUrl,
      openAiApiKey
    });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Render could not be started.";

    await db.$transaction(async (tx: any) => {
      await tx.renderJob.update({
        where: {
          id: renderJob.id
        },
        data: {
          status: "failed",
          failureReason
        }
      });

      await tx.visualAsset.update({
        where: {
          id: outputAsset.id
        },
        data: {
          status: "failed"
        }
      });

      if (submissionId) {
        await tx.promptSubmission.update({
          where: {
            id: submissionId
          },
          data: {
            status: "approved",
            selectedAt: null
          }
        });
      }
    });

    await recordAuditEvent({
      type: "render.start_failed",
      summary: "Could not start a remix render",
      details: failureReason,
      sessionId
    });

    return null;
  }

  if (started.kind === "demo") {
    await db.renderJob.update({
      where: {
        id: renderJob.id
      },
      data: {
        openaiVideoId: started.videoId,
        status: "completed"
      }
    });

    await reconcileRenderJob(renderJob.id);
    return renderJob;
  }

  await db.renderJob.update({
    where: {
      id: renderJob.id
    },
    data: {
      openaiVideoId: started.videoId,
      status: "queued"
    }
  });

  return renderJob;
}

export async function reconcilePendingRenderJobs(sessionId: string) {
  const jobs = await db.renderJob.findMany({
    where: {
      sessionId,
      status: {
        in: ["queued", "in_progress"]
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  for (const job of jobs) {
    await reconcileRenderJob(job.id);
  }

  await attemptAutomatedSelection(sessionId);

  return jobs.length;
}

function addNegativeConstraints(promptText: string, negativePrompt: string) {
  const normalizedNegativePrompt = normalizePromptText(negativePrompt);

  if (!normalizedNegativePrompt) {
    return promptText;
  }

  if (promptText.toLowerCase().includes(normalizedNegativePrompt.toLowerCase())) {
    return promptText;
  }

  return normalizePromptText(`${promptText} Avoid: ${normalizedNegativePrompt}.`);
}
