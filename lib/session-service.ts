import { db } from "@/lib/db";
import { getTwitchConnectionStatus } from "@/lib/twitch";
import { recordAuditEvent } from "@/lib/audit";
import { completePlaybackTransition } from "@/lib/playback-transition";
import {
  normalizeShowWordmarkOpacity,
  normalizeShowWordmarkSize,
  showProgressOverlayDisabledEvent,
  showProgressOverlayEnabledEvent,
  showQrOverlayDisabledEvent,
  showQrOverlayEnabledEvent,
  showWordmarkAudioReactiveOnlyDisabledEvent,
  showWordmarkAudioReactiveOnlyEnabledEvent,
  showWordmarkOpacityEvent,
  showWordmarkSizeEvent,
  showWordmarkOverlayDisabledEvent,
  showWordmarkOverlayEnabledEvent
} from "@/lib/show-overlay-state";
import {
  serializeSubmissionRateLimitSettings,
  submissionRateLimitConfiguredEvent,
  submissionRateLimitWindowMinutes
} from "@/lib/submission-rate-limit-state";
import { createSessionCode, normalizePromptText } from "@/lib/utils";
import { queueAutomatedRender } from "@/lib/submission-pipeline";
import { reconcileRenderJob } from "@/lib/rendering";
import { canRecoverSeedRender, classifySeedPreparationFailure } from "@/lib/seed-render-recovery";
import {
  normalizeVideoDurationSecondsForModel,
  normalizeVideoModelId,
  normalizeVideoResolution,
  type VideoModelId
} from "@/lib/video-models";

export { completePlaybackTransition } from "@/lib/playback-transition";

type SessionInput = {
  name: string;
  artistName: string;
  trackName: string;
  creativeBible: string;
  allowedMotifs: string;
  bannedTerms: string;
  colorPalette: string;
  motionRules: string;
  basePrompt: string;
  imageReferenceUrl?: string;
  smsNumber?: string;
  venueSafeMode: boolean;
  artistControlEnabled: boolean;
  autoSelectEnabled: boolean;
  videoModel?: VideoModelId | string | null;
  videoDurationSeconds: number;
  videoResolution?: string;
  audienceMode?: "web" | "twitch";
  twitchChannel?: string;
  submissionRateLimitEnabled: boolean;
  submissionRateLimitCount: number;
};

export const initialGenerationQueueFailureMessage =
  "The first video could not be queued. Retry the generation.";
export const initialGenerationRecoveryFailureMessage =
  "The existing clip could not be recovered. No new generation was requested. Try recovering it again.";

export async function createDjSession(userId: string, input: SessionInput) {
  const code = createSessionCode("story");
  const videoModel = normalizeVideoModelId(input.videoModel);
  const videoDurationSeconds = normalizeVideoDurationSecondsForModel(
    videoModel,
    input.videoDurationSeconds
  );

  const session = await db.dJSession.create({
    data: {
      userId,
      code,
      name: input.name || input.basePrompt.trim().slice(0, 72),
      artistName: input.artistName,
      trackName: input.trackName,
      creativeBible: normalizePromptText(input.creativeBible || input.basePrompt),
      allowedMotifs: input.allowedMotifs,
      bannedTerms: input.bannedTerms,
      colorPalette: input.colorPalette,
      motionRules: input.motionRules,
      basePrompt: normalizePromptText(input.basePrompt),
      imageReferenceUrl: input.imageReferenceUrl || null,
      smsNumber: input.smsNumber || null,
      venueSafeMode: input.venueSafeMode,
      artistControlEnabled: input.artistControlEnabled,
      autoSelectEnabled: input.autoSelectEnabled,
      videoModel,
      videoDurationSeconds,
      videoResolution: normalizeVideoResolution(input.videoResolution),
      audienceMode: input.audienceMode ?? "web",
      twitchChannel: input.audienceMode === "twitch" ? input.twitchChannel ?? null : null,
      playbackState: {
        create: {
          status: "idle"
        }
      }
    },
    include: {
      playbackState: true
    }
  });

  await recordAuditEvent({
    type: "session.created",
    summary: `Created session ${session.name}`,
    sessionId: session.id,
    userId
  });

  await recordAuditEvent({
    type: submissionRateLimitConfiguredEvent,
    summary: input.submissionRateLimitEnabled
      ? `Limited each device to ${input.submissionRateLimitCount} remixes per ${submissionRateLimitWindowMinutes} minutes`
      : "Left the device submission limit off",
    details: serializeSubmissionRateLimitSettings({
      enabled: input.submissionRateLimitEnabled,
      count: input.submissionRateLimitCount
    }),
    sessionId: session.id,
    userId
  });

  return session;
}

export async function getPrimarySessionForUser(userId: string) {
  return db.dJSession.findFirst({
    where: {
      userId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      playbackState: true
    }
  });
}

export async function startDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  if (ownedSession.audienceMode === "twitch") {
    const connection = await getTwitchConnectionStatus(userId);
    if (!connection.connected || connection.login !== ownedSession.twitchChannel) {
      throw new Error("Reconnect the Twitch account for this story before starting it.");
    }
  }

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "live",
      startedAt: new Date(),
      stoppedAt: null,
      playbackState: {
        update: {
          status: "holding",
          emergencyPaused: false
        }
      }
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      }
    }
  });

  if (!session.playbackState?.currentAssetId && session.renderJobs.length === 0) {
    const recovery = await recoverFailedInitialRender(session.id, userId);

    // A recovery attempt never falls through to a new billable generation,
    // including when another request owns the claim or preparation fails.
    if (recovery !== "not-recoverable") return session;

    const queuedRender = await queueAutomatedRender(
      session.id,
      null,
      "seed",
      session.basePrompt
    );

    if (!queuedRender) {
      const generationState = await db.dJSession.findUnique({
        where: {
          id: session.id
        },
        select: {
          playbackState: {
            select: {
              currentAssetId: true
            }
          },
          renderJobs: {
            where: {
              mode: "seed",
              OR: [
                {
                  status: {
                    in: ["queued", "in_progress"]
                  }
                },
                {
                  updatedAt: {
                    gte: session.startedAt ?? new Date(0)
                  }
                }
              ]
            },
            select: {
              id: true
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
            orderBy: [
              {
                createdAt: "asc"
              },
              {
                id: "asc"
              }
            ],
            select: {
              id: true
            },
            take: 1
          }
        }
      });
      const readyAssetId = generationState?.visualAssets[0]?.id ?? null;
      let recoveredReadyAsset = false;

      if (
        generationState &&
        !generationState.playbackState?.currentAssetId &&
        readyAssetId
      ) {
        recoveredReadyAsset = await adoptReadyInitialAsset(
          session.id,
          readyAssetId
        );

        if (!recoveredReadyAsset) {
          const latestPlayback = await db.playbackState.findUnique({
            where: {
              sessionId: session.id
            },
            select: {
              currentAssetId: true
            }
          });

          recoveredReadyAsset = Boolean(latestPlayback?.currentAssetId);
        }
      }

      if (
        !generationState ||
        (!generationState.playbackState?.currentAssetId &&
          generationState.renderJobs.length === 0 &&
          !recoveredReadyAsset)
      ) {
        throw new Error(initialGenerationQueueFailureMessage);
      }
    }
  }

  await recordAuditEvent({
    type: "session.started",
    summary: `Started session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

async function recoverFailedInitialRender(sessionId: string, userId: string) {
  const recovery = await db.$transaction(async (tx) => {
    const current = await tx.dJSession.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        updatedAt: true,
        playbackState: { select: { currentAssetId: true } },
        renderJobs: {
          where: { status: { in: ["queued", "in_progress"] } },
          select: { id: true },
          take: 1
        }
      }
    });
    if (!current || current.userId !== userId) throw new Error("Session not found.");
    if (current.playbackState?.currentAssetId || current.renderJobs.length > 0) {
      return { kind: "already-active" as const };
    }

    const seed = await tx.renderJob.findFirst({
      where: { sessionId, mode: "seed" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        mode: true,
        status: true,
        submissionId: true,
        providerStrategy: true,
        providerRequestId: true,
        providerOutputUri: true,
        outputAssetId: true,
        failureReason: true,
        outputAsset: { select: { status: true } }
      }
    });
    if (!seed || !canRecoverSeedRender(seed)) return { kind: "not-recoverable" as const };

    // Match the generation queue's session lease so a concurrent seed cannot
    // be submitted between inspecting and reclaiming the existing render.
    const sessionClaim = await tx.dJSession.updateMany({
      where: {
        id: sessionId,
        userId,
        updatedAt: current.updatedAt,
        playbackState: { is: { currentAssetId: null } },
        renderJobs: { none: { status: { in: ["queued", "in_progress"] } } }
      },
      data: { updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) }
    });
    if (sessionClaim.count !== 1) return { kind: "already-active" as const };

    const jobClaim = await tx.renderJob.updateMany({
      where: {
        id: seed.id,
        sessionId,
        mode: "seed",
        status: "failed",
        submissionId: null,
        providerStrategy: seed.providerStrategy,
        providerRequestId: seed.providerRequestId,
        providerOutputUri: seed.providerOutputUri,
        outputAssetId: seed.outputAssetId
      },
      data: {
        status: "in_progress",
        failureReason: null,
        providerFailureCode: null,
        completedAt: null,
        lastPolledAt: null
      }
    });
    if (jobClaim.count !== 1) return { kind: "already-active" as const };
    const assetClaim = await tx.visualAsset.updateMany({
      where: { id: seed.outputAssetId!, sessionId, status: "failed" },
      data: { status: "processing" }
    });
    if (assetClaim.count !== 1) throw new Error(initialGenerationRecoveryFailureMessage);

    return {
      kind: "claimed" as const,
      jobId: seed.id,
      requestId: seed.providerRequestId,
      previousFailureCode: classifySeedPreparationFailure(seed.failureReason)
    };
  });

  if (recovery.kind !== "claimed") return recovery.kind;

  console.info("[session-start] recovering existing seed", {
    sessionId,
    renderJobId: recovery.jobId,
    providerRequestId: recovery.requestId,
    previousFailureCode: recovery.previousFailureCode
  });
  try {
    const result = await reconcileRenderJob(recovery.jobId);
    if (!result || result.status === "failed") throw new Error(initialGenerationRecoveryFailureMessage);
  } catch {
    throw new Error(initialGenerationRecoveryFailureMessage);
  }
  return "recovered" as const;
}

async function adoptReadyInitialAsset(sessionId: string, assetId: string) {
  return db.$transaction(async (tx: any) => {
    const claim = await tx.playbackState.updateMany({
      where: {
        sessionId,
        currentAssetId: null
      },
      data: {
        currentAssetId: assetId,
        status: "live",
        lastTransitionAt: new Date()
      }
    });

    if (claim.count !== 1) {
      return false;
    }

    await tx.visualAsset.update({
      where: {
        id: assetId
      },
      data: {
        status: "live"
      }
    });

    return true;
  });
}

export async function stopDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "stopped",
      stoppedAt: new Date(),
      playbackState: {
        update: {
          emergencyPaused: true,
          status: "idle"
        }
      }
    }
  });

  await recordAuditEvent({
    type: "session.stopped",
    summary: `Stopped session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function clearDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  await db.dJSession.delete({
    where: {
      id: ownedSession.id
    }
  });

  // The session row is gone, so the audit event cannot reference it.
  await recordAuditEvent({
    type: "session.cleared",
    summary: `Cleared session ${ownedSession.name} to start a new one`,
    userId
  });

  return ownedSession;
}

export async function setSelectionPause(sessionId: string, userId: string, paused: boolean) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      autoSelectEnabled: !paused,
      playbackState: {
        update: {
          emergencyPaused: paused
        }
      }
    }
  });

  await recordAuditEvent({
    type: paused ? "session.paused" : "session.resumed",
    summary: paused ? "Paused automated prompt selection" : "Resumed automated prompt selection",
    sessionId,
    userId
  });

  return session;
}

export async function setShowQrOverlayVisibility(sessionId: string, userId: string, visible: boolean) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showQrOverlayEnabledEvent : showQrOverlayDisabledEvent,
    summary: visible ? "Showed the audience QR overlay" : "Hid the audience QR overlay",
    sessionId,
    userId
  });
}

export async function setShowWordmarkOverlayVisibility(sessionId: string, userId: string, visible: boolean) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showWordmarkOverlayEnabledEvent : showWordmarkOverlayDisabledEvent,
    summary: visible ? "Showed the centered wordmark overlay" : "Hid the centered wordmark overlay",
    sessionId,
    userId
  });
}

export async function setShowWordmarkOpacity(sessionId: string, userId: string, opacity: number) {
  await requireOwnedSession(sessionId, userId);

  const normalizedOpacity = normalizeShowWordmarkOpacity(opacity);

  await recordAuditEvent({
    type: showWordmarkOpacityEvent,
    summary: `Set the wordmark opacity to ${Math.round(normalizedOpacity * 100)}%`,
    details: String(normalizedOpacity),
    sessionId,
    userId
  });
}

export async function setShowWordmarkSize(sessionId: string, userId: string, size: number) {
  await requireOwnedSession(sessionId, userId);

  const normalizedSize = normalizeShowWordmarkSize(size);

  await recordAuditEvent({
    type: showWordmarkSizeEvent,
    summary: `Set the wordmark size to ${Math.round(normalizedSize * 100)}%`,
    details: String(normalizedSize),
    sessionId,
    userId
  });
}

export async function setShowWordmarkAudioReactiveOnly(
  sessionId: string,
  userId: string,
  wordmarkOnly: boolean
) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: wordmarkOnly
      ? showWordmarkAudioReactiveOnlyEnabledEvent
      : showWordmarkAudioReactiveOnlyDisabledEvent,
    summary: wordmarkOnly
      ? "Applied audio-reactive VFX only to the wordmark"
      : "Applied audio-reactive VFX to the generated visuals",
    sessionId,
    userId
  });
}

export async function setShowProgressOverlayVisibility(
  sessionId: string,
  userId: string,
  visible: boolean
) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showProgressOverlayEnabledEvent : showProgressOverlayDisabledEvent,
    summary: visible
      ? "Showed the next-remix progress overlay"
      : "Hid the next-remix progress overlay",
    sessionId,
    userId
  });
}

export async function forceTransitionToNext(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    },
    include: {
      playbackState: true
    }
  });

  if (!session?.playbackState?.nextAssetId) {
    return null;
  }

  return completePlaybackTransition(sessionId);
}

export async function cueHistoricalGeneration(sessionId: string, userId: string, assetId: string) {
  const selectedAsset = await db.$transaction(async (tx: any) => {
    const session = await tx.dJSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: "live"
      },
      select: {
        id: true,
        playbackState: {
          select: {
            id: true,
            currentAssetId: true,
            nextAssetId: true
          }
        }
      }
    });

    if (!session?.playbackState || session.playbackState.currentAssetId === assetId) {
      return null;
    }

    const asset = await tx.visualAsset.findFirst({
      where: {
        id: assetId,
        sessionId,
        publicUrl: {
          not: null
        },
        status: {
          in: ["ready", "live", "archived"]
        }
      },
      select: {
        id: true,
        title: true,
        sourceSubmission: {
          select: {
            rawText: true,
            sender: true,
            source: true
          }
        }
      }
    });

    if (!asset) {
      return null;
    }

    const cueClaim = await tx.playbackState.updateMany({
      where: {
        id: session.playbackState.id,
        currentAssetId: session.playbackState.currentAssetId,
        nextAssetId: session.playbackState.nextAssetId
      },
      data: {
        nextAssetId: asset.id,
        status: "live"
      }
    });

    if (cueClaim.count !== 1) {
      const latestPlayback = await tx.playbackState.findUnique({
        where: {
          id: session.playbackState.id
        },
        select: {
          currentAssetId: true
        }
      });

      return latestPlayback?.currentAssetId === asset.id ? asset : null;
    }

    await tx.visualAsset.update({
      where: {
        id: asset.id
      },
      data: {
        status: "ready"
      }
    });

    return asset;
  });

  if (!selectedAsset) {
    return null;
  }

  await recordAuditEvent({
    type: "playback.history_cued",
    summary: "Queued a previous generation for immediate crossfade",
    details: `Selected visual asset ${selectedAsset.id}`,
    sessionId,
    userId
  });

  return selectedAsset;
}

export async function queueFallbackRemix(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    return null;
  }

  const prompt = buildFallbackRemixPrompt(session);

  await queueAutomatedRender(session.id, null, session.status === "live" ? "remix" : "seed", prompt);

  await recordAuditEvent({
    type: "session.fallback_remix",
    summary: "Queued a manual fallback remix",
    sessionId,
    userId
  });

  return true;
}

export function buildFallbackRemixPrompt(session: {
  basePrompt: string;
}) {
  return [
    "Continue the story with one new, natural event, starting from the current final frame.",
    `Story opening for context only: ${session.basePrompt}`,
    "Preserve the characters and visual style. Advance the action without restarting the opening."
  ].join(" ");
}

async function requireOwnedSession(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}
