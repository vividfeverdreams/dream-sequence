import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { assessSubmission } from "@/lib/ai-assessment";
import { checkSubmissionRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";
import {
  shouldRecoverReadyPlaybackAsset,
  takePlaybackAsset
} from "@/lib/playback-transition";
import { hashValue, normalizePromptText } from "@/lib/utils";
import {
  failRenderJob,
  formatVideoModerationFailureReason,
  getVideoProviderFailureCode,
  isVideoModerationError,
  reconcileRenderJob,
  startVideoRender
} from "@/lib/rendering";
import {
  assessSubmissionImage,
  participantImageModerationBlockedReason,
  type ImageModerationAssessment
} from "@/lib/image-moderation";
import {
  getParticipantModerationBlockCount,
  getParticipantModerationEventType,
  getParticipantBlocksRemaining,
  isParticipantBanned,
  participantImageModerationEventSummary,
  participantModerationBanThreshold
} from "@/lib/participant-session";
import { persistSubmissionImage } from "@/lib/storage";
import type { ValidatedSubmissionImage } from "@/lib/submission-image";
import {
  getSubmissionRateLimitSettings,
  submissionRateLimitConfiguredEvent
} from "@/lib/submission-rate-limit-state";
import {
  normalizeVideoDurationSecondsForModel,
  normalizeVideoModelId,
  normalizeVideoResolution
} from "@/lib/video-models";
import { composeFinalProviderVideoPrompt } from "@/lib/video-prompt-budget";

type IntakeInput = {
  sessionCode: string;
  source: "sms" | "web" | "twitch";
  prompt: string;
  sender?: string | null;
  senderFingerprintSeed: string;
  participantToken?: string | null;
  messageSid?: string | null;
  referenceImage?: ValidatedSubmissionImage | null;
};

type IntakeOptions = {
  scheduleSelection?: (sessionId: string) => void;
};

export async function ingestSubmission(input: IntakeInput, options: IntakeOptions = {}) {
  if (input.messageSid) {
    const existing = await db.promptSubmission.findUnique({
      where: {
        messageSid: input.messageSid
      }
    });

    if (existing) {
      return {
        status: "approved" as const,
        message: "That story idea is already in the queue.",
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
      auditEvents: {
        where: {
          type: submissionRateLimitConfiguredEvent
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
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

  if (session.audienceMode === "twitch" && input.source !== "twitch") {
    throw new Error("This story takes ideas from Twitch chat. Use !next followed by your idea.");
  }
  if (session.audienceMode !== "twitch" && input.source === "twitch") {
    throw new Error("This story takes ideas from its audience page.");
  }
  if (!input.prompt.trim() || input.prompt.trim().length > 1200) {
    throw new Error("Story ideas must be between 1 and 1200 characters.");
  }

  const senderFingerprintSeed =
    input.source === "web" ? input.participantToken?.trim() : input.senderFingerprintSeed;

  if (input.source === "web" && (!senderFingerprintSeed || !input.sender?.trim())) {
    throw new Error("Choose a nickname before sending your remix.");
  }

  const senderFingerprint = hashValue(`${session.id}:${senderFingerprintSeed}`);

  if (input.source === "web") {
    const moderationBlockCount = await getParticipantModerationBlockCount(
      session.id,
      senderFingerprint
    );

    if (isParticipantBanned(moderationBlockCount)) {
      return {
        status: "banned" as const,
        message: `This device is locked out for the rest of this live sequence after ${participantModerationBanThreshold} blocked reference images.`,
        moderationBlockCount
      };
    }
  }

  const submissionRateLimit = getSubmissionRateLimitSettings(session.auditEvents);
  const rateLimit = await checkSubmissionRateLimit(
    session.id,
    senderFingerprint,
    submissionRateLimit.enabled ? submissionRateLimit.count : null
  );

  if (!rateLimit.allowed) {
    return {
      status: "rate-limited" as const,
      message: rateLimit.reason ?? "Please wait before sending another remix."
    };
  }

  const normalizedText = normalizePromptText(input.prompt);
  const recentWinningPrompts = session.submissions
    .map((item: any) => item.rankingResult?.winningPrompt)
    .filter((value: any): value is string => Boolean(value));
  const [assessment, imageAssessment] = await Promise.all([
    assessSubmission({
      submissionText: session.artistControlEnabled
        ? normalizedText
        : input.prompt.trim(),
      session,
      recentWinningPrompts
    }),
    input.referenceImage
      ? assessSubmissionImage({
          image: input.referenceImage,
          userId: String(session.userId)
        })
      : Promise.resolve<ImageModerationAssessment | null>(null)
  ]);
  const imageRejected = imageAssessment?.decision === "rejected";
  const decision = imageRejected ? "rejected" : assessment.decision;
  const approvalReason = imageRejected
    ? imageAssessment.explanation
    : assessment.approvalReason;
  const moderationFlags = imageRejected
    ? [...new Set([...assessment.flags, ...imageAssessment.flags])]
    : assessment.flags;
  const moderationExplanation = imageAssessment
    ? `${imageAssessment.explanation} ${assessment.explanation}`
    : assessment.explanation;
  const storedImage =
    input.referenceImage && decision === "approved"
      ? await persistSubmissionImage(session.id, input.referenceImage)
      : null;

  const submission = await db.$transaction(async (tx: any) => {
    const created = await tx.promptSubmission.create({
    data: {
      sessionId: session.id,
      source: input.source,
      sender: input.sender ? normalizePromptText(input.sender) : null,
      senderFingerprint,
      messageSid: input.messageSid || null,
      rawText: input.prompt,
      normalizedText,
      referenceImageUrl: storedImage?.publicUrl ?? null,
      referenceImageStoragePath: storedImage?.storagePath ?? null,
      referenceImageMimeType:
        storedImage && input.referenceImage
          ? input.referenceImage.mimeType
          : null
    }
  });

    await tx.moderationResult.create({
      data: {
        submissionId: created.id,
        decision,
        score: imageRejected ? 0 : assessment.score,
        flags: JSON.stringify(moderationFlags),
        explanation: moderationExplanation
      }
    });

    await tx.rankingResult.create({
      data: {
        submissionId: created.id,
        score: imageRejected ? 0 : assessment.score,
        noveltyScore: imageRejected ? 0 : assessment.noveltyScore,
        cohesionScore: imageRejected ? 0 : assessment.cohesionScore,
        remixDeltaScore: imageRejected ? 0 : assessment.remixDeltaScore,
        winningPrompt: imageRejected ? input.prompt.trim() : assessment.winningPrompt,
        explanation: approvalReason
      }
    });

    await tx.promptSubmission.update({
      where: {
        id: created.id
      },
      data: {
        status: decision === "approved" ? "approved" : "rejected",
        approvalReason
      }
    });
    return created;
  });

  try {
    await recordAuditEvent({
      type: decision === "approved" ? "submission.approved" : "submission.rejected",
      summary: `Processed ${input.source} submission`,
      details: moderationExplanation,
      sessionId: session.id
    });
  } catch {
    // The receipt and moderation decision are already committed. An optional
    // activity-log write must not make the audience retry a saved idea.
    console.warn("[submission-intake] activity logging failed after receipt was saved", {
      sessionId: session.id,
      submissionId: submission.id
    });
  }

  if (imageRejected) {
    await recordAuditEvent({
      type: getParticipantModerationEventType(senderFingerprint),
      summary: participantImageModerationEventSummary,
      details: `${participantImageModerationBlockedReason} ${imageAssessment.flags.join(", ")}`,
      sessionId: session.id
    });
    const moderationBlockCount = await getParticipantModerationBlockCount(
      session.id,
      senderFingerprint
    );
    const banned = isParticipantBanned(moderationBlockCount);
    const blocksRemaining = getParticipantBlocksRemaining(
      moderationBlockCount
    );

    return {
      status: banned ? ("banned" as const) : ("rejected" as const),
      message: banned
        ? "This was the third blocked reference image, so this device is locked for the rest of the live sequence."
        : `That photo did not pass venue-safe image moderation. ${blocksRemaining} ${
            blocksRemaining === 1 ? "strike" : "strikes"
          } remaining before this device is locked.`,
      submissionId: submission.id,
      moderationBlockCount,
      blocksRemaining
    };
  }

  if (decision === "approved") {
    if (options.scheduleSelection) {
      try {
        options.scheduleSelection(session.id);
      } catch {
        // The saved idea remains eligible for the next reconciliation pass even
        // when a response-bound background task could not be scheduled.
        console.warn("[submission-intake] selection scheduling will retry", {
          sessionId: session.id
        });
      }
    } else {
      await attemptAutomatedSelection(session.id);
    }
  }

  return {
    status: decision,
    message:
      decision === "approved"
        ? session.artistControlEnabled
          ? "Your idea is in the story queue."
          : "Your idea is in the story queue."
        : "That idea did not pass the story safety check.",
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
      visualAssets: {
        where: {
          status: "ready",
          publicUrl: {
            not: null
          }
        },
        select: {
          id: true,
          updatedAt: true
        },
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      },
      submissions: {
        where: {
          status: "approved",
          selectedAt: null
        },
        include: {
          rankingResult: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!session?.playbackState) {
    return null;
  }

  if (session.status !== "live" || !session.autoSelectEnabled || session.playbackState.emergencyPaused) {
    return null;
  }

  if (session.renderJobs.length > 0) {
    return null;
  }

  const readyAsset = session.visualAssets[0];

  if (readyAsset) {
    if (
      !shouldRecoverReadyPlaybackAsset({
        readyAssetId: readyAsset.id,
        nextAssetId: session.playbackState.nextAssetId,
        readyAssetUpdatedAt: readyAsset.updatedAt
      })
    ) {
      return null;
    }

    const transitioned = await takePlaybackAsset(sessionId, readyAsset.id);

    if (!transitioned) {
      console.warn("[playback-queue] ready asset could not become current", {
        sessionId,
        assetId: readyAsset.id
      });
      return null;
    }

    console.info("[playback-queue] recovered ready asset as current", {
      sessionId,
      assetId: readyAsset.id
    });
  }

  const promotedAssetId = await promoteOldestReadyAsset(sessionId, db, {
    allowArchivedRotation: false
  });

  if (promotedAssetId) {
    console.info("[playback-queue] staged rotation asset", {
      sessionId,
      assetId: promotedAssetId
    });
  }

  const nextSubmission = [...session.submissions]
    .filter((submission) => submission.rankingResult)
    .sort((left, right) => (right.rankingResult?.score ?? 0) - (left.rankingResult?.score ?? 0))[0];

  if (!nextSubmission?.rankingResult) {
    return null;
  }

  return queueAutomatedRender(
    sessionId,
    nextSubmission.id,
    readyAsset || session.playbackState.currentAssetId ? "remix" : "seed",
    nextSubmission.rankingResult.winningPrompt
  );
}

class AutomatedRenderSubmissionClaimConflict extends Error {}

function getNextGenerationLeaseTimestamp(value: Date | string | null | undefined) {
  const previousTimestamp = value ? new Date(value).getTime() : Number.NaN;
  const now = Date.now();

  return new Date(
    Number.isFinite(previousTimestamp)
      ? Math.max(now, previousTimestamp + 1)
      : now
  );
}

export async function queueAutomatedRender(
  sessionId: string,
  submissionId: string | null,
  requestedMode: "seed" | "remix",
  promptText: string
) {
  let queuedRender;

  try {
    queuedRender = await db.$transaction(async (tx: any) => {
      const session = await tx.dJSession.findUnique({
        where: {
          id: sessionId
        },
        include: {
          playbackState: {
            include: {
              currentAsset: true
            }
          },
          renderJobs: {
            where: {
              status: {
                in: ["queued", "in_progress"]
              }
            },
            take: 1
          },
          visualAssets: {
            where: {
              status: "ready",
              publicUrl: {
                not: null
              }
            },
            select: {
              id: true
            },
            take: 1
          }
        }
      });

      if (!session?.playbackState || session.status !== "live" ||
          (requestedMode === "remix" && session.playbackState.emergencyPaused)) {
        return null;
      }

      if (session.renderJobs.length > 0 || session.visualAssets.length > 0) {
        return null;
      }

      const [generationHead, sourceSubmission] = await Promise.all([
        requestedMode === "remix"
          ? tx.renderJob.findFirst({
              where: {
                sessionId,
                status: "completed"
              },
              orderBy: [
                {
                  createdAt: "desc"
                },
                {
                  id: "desc"
                }
              ],
              select: {
                outputAsset: {
                  select: {
                    id: true,
                    promptText: true,
                    publicUrl: true,
                    thumbnailUrl: true,
                    sourceVideoId: true,
                    status: true
                  },
                }
              }
            })
          : Promise.resolve(null),
        submissionId
          ? tx.promptSubmission.findUnique({
              where: {
                id: submissionId
              },
              select: {
                rawText: true,
                referenceImageUrl: true
              }
            })
          : Promise.resolve(null)
      ]);
      // Completed render order is the generation lineage. Playback can rotate or
      // manually cue any historical clip without moving this generation head.
      const completedOutput = generationHead?.outputAsset;
      const completedOutputIsUsable = Boolean(
        completedOutput?.publicUrl &&
          ["ready", "live", "archived"].includes(completedOutput.status)
      );
      const sourceAsset = generationHead
        ? completedOutputIsUsable
          ? completedOutput
          : null
        : session.playbackState.currentAsset?.publicUrl
          ? session.playbackState.currentAsset
          : null;

      if (requestedMode === "remix" && !sourceAsset?.publicUrl) {
        return {
          sourceMissing: true as const,
          session
        };
      }

      // Updating the session timestamp is a lightweight per-session generation
      // lease. Competing transactions that read the same timestamp cannot both
      // create sibling remixes from one parent.
      const generationClaim = await tx.dJSession.updateMany({
        where: {
          id: session.id,
          updatedAt: session.updatedAt
        },
        data: {
          updatedAt: getNextGenerationLeaseTimestamp(session.updatedAt)
        }
      });

      if (generationClaim.count !== 1) {
        return null;
      }

      if (submissionId) {
        const submissionClaim = await tx.promptSubmission.updateMany({
          where: {
            id: submissionId,
            sessionId,
            status: "approved",
            selectedAt: null
          },
          data: {
            status: "queued",
            selectedAt: new Date()
          }
        });

        if (submissionClaim.count !== 1) {
          // Throwing rolls back the session lease too, so a losing selector
          // cannot strand this prompt in the queued state without a render job.
          throw new AutomatedRenderSubmissionClaimConflict();
        }
      }

      const mode = requestedMode;
      const videoModel = normalizeVideoModelId(session.videoModel);
      const durationSeconds = normalizeVideoDurationSecondsForModel(
        videoModel,
        session.videoDurationSeconds
      );
      const outputAsset = await tx.visualAsset.create({
        data: {
          sessionId,
          sourceSubmissionId: submissionId,
          kind: mode,
          title: mode === "seed" ? "The story begins" : "What happens next",
          promptText,
          durationSeconds,
          status: "processing"
        }
      });
      const renderJob = await tx.renderJob.create({
        data: {
          sessionId,
          submissionId,
          sourceAssetId: sourceAsset?.id ?? null,
          outputAssetId: outputAsset.id,
          mode,
          status: "queued",
          promptText
        }
      });

      return {
        sourceMissing: false as const,
        durationSeconds,
        videoModel,
        outputAsset,
        renderJob,
        session,
        sourceAsset,
        sourceSubmission
      };
    });
  } catch (error) {
    if (error instanceof AutomatedRenderSubmissionClaimConflict) {
      return null;
    }

    throw error;
  }

  if (!queuedRender) {
    return null;
  }

  if (queuedRender.sourceMissing) {
    await recordAuditEvent({
      type: "render.source_missing",
      summary: "Skipped a remix because no source video was available",
      details: promptText,
      sessionId
    });
    return null;
  }

  const {
    durationSeconds,
    videoModel,
    outputAsset,
    renderJob,
    session,
    sourceAsset,
    sourceSubmission
  } = queuedRender;
  const mode = requestedMode;

  const creativePrompt = mode === "seed"
    ? session.basePrompt
    : [
        `What happens next: ${sourceSubmission?.rawText?.trim() || promptText}`,
        `Story opening (background only; do not restart): ${session.basePrompt}`
      ].join(" ");
  const providerPrompt = composeFinalProviderVideoPrompt({
    creativePrompt,
    includeArtistMotionRules: false,
    openingFrameAttached: mode === "remix"
  });

  try {
    await db.$transaction(async (tx: any) => {
      await tx.renderJob.update({
        where: {
          id: renderJob.id
        },
        data: {
          promptText: providerPrompt
        }
      });
      await tx.visualAsset.update({
        where: {
          id: outputAsset.id
        },
        data: {
          promptText: providerPrompt
        }
      });
    });
  } catch (error) {
    const failureReason = "The final provider prompt could not be persisted.";

    console.warn("[provider-prompt] could not persist final prompt", {
      sessionId,
      renderJobId: renderJob.id,
      sourceAssetId: sourceAsset?.id ?? null,
      reason: error instanceof Error ? error.name : "unknown_error"
    });
    await failRenderJob(renderJob.id, failureReason);
    await recordAuditEvent({
      type: "render.prompt_persistence_failed",
      summary: "Could not persist the final provider prompt",
      details: failureReason,
      sessionId
    });
    return null;
  }

  let started;

  try {
    started = await startVideoRender({
      mode,
      prompt: providerPrompt,
      sourceVideoUrl: sourceAsset?.publicUrl,
      falApiKey: env.falApiKey,
      videoModel,
      resolution: normalizeVideoResolution(session.videoResolution),
      durationSeconds
    });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Render could not be started.";
    const moderationBlocked = isVideoModerationError(error);
    const providerFailureCode = getVideoProviderFailureCode(error);

    await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(failureReason)
        : failureReason,
      {
        moderationBlocked,
        providerFailureCode
      }
    );

    await recordAuditEvent({
      type: moderationBlocked ? "render.moderation_blocked" : "render.start_failed",
      summary: moderationBlocked
        ? "Video provider moderation blocked a remix before rendering"
        : "Could not start a remix render",
      details: JSON.stringify({
        failureReason,
        providerFailureCode
      }),
      sessionId
    });

    return null;
  }

  let startClaim = { count: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Retrying this database write is safe even if the previous write committed
      // and only its response was lost. The provider generation is never repeated.
      startClaim = await db.renderJob.updateMany({
        where: {
          id: renderJob.id,
          status: "queued",
          OR: [
            { providerRequestId: null },
            { providerRequestId: started.requestId }
          ]
        },
        data: {
          providerRequestId: started.requestId,
          providerOutputUri: started.outputUri,
          providerStrategy: started.strategy,
          status: "queued",
          failureReason: null
        }
      });
      break;
    } catch {
      if (attempt < 2) continue;
      console.error("[render-job] could not save the accepted fal request", {
        renderJobId: renderJob.id,
        providerRequestId: started.requestId
      });
      // The accepted request may still be rendering and billable. Do not select
      // this same audience prompt again automatically if persistence stays down.
      await failRenderJob(renderJob.id,
        "fal.ai accepted this clip, but its request ID could not be saved. Check the fal.ai queue before retrying.",
        { providerFailureCode: "FAL_SUBMISSION_UNKNOWN", retryAllowed: false }
      ).catch(() => undefined);
      return null;
    }
  }

  // A late provider response must never resurrect a job that reconciliation or
  // moderation already made terminal.
  if (startClaim.count !== 1) {
    return null;
  }

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

  const updates = [];

  for (const job of jobs) {
    const update = await reconcileRenderJob(job.id);

    updates.push({
      id: job.id,
      status: update?.status ?? job.status,
      progress: update?.progress ?? null
    });
  }

  // A render can finish after crowd prompts arrived while its slot was busy.
  // Re-open selection here so those approved prompts do not wait forever,
  // especially after the initial seed becomes the current live asset.
  await attemptAutomatedSelection(sessionId);

  return updates;
}
