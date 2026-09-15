import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  downloadFalVideo,
  FalApiError,
  isFalModerationError,
  isRetryableFalError,
  retrieveFalVideoResult,
  retrieveFalVideoStatus,
  startFalVideoRender
} from "@/lib/fal-video";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";
import { estimateVideoRenderProgress } from "@/lib/render-progress";
import { recordRenderJobProgress } from "@/lib/render-progress-state";
import { persistVideoAsset } from "@/lib/storage";
import { readVideoMetadata } from "@/lib/video-closing-frame";
import { normalizeProviderFailureCode, videoModerationBlockedReason } from "@/lib/video-moderation";

export { isVideoModerationFailureReason, videoModerationBlockedReason } from "@/lib/video-moderation";

const pendingRequestTimeoutMs = 2 * 60 * 1_000;
const falRecoveryTimeoutMs = 30 * 60 * 1_000;
const completionFailureLogIntervalMs = 60_000;
const maximumCompletionFailureLogEntries = 256;
const completionFailureLogTimes = new Map<string, number>();

type RenderCompletionPhase =
  | "provider_status"
  | "provider_result"
  | "save_provider_status"
  | "save_output_uri"
  | "download_video"
  | "read_video_metadata"
  | "persist_video_asset"
  | "place_playback_asset";

function boundedDiagnosticIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,96}$/.test(value)
    ? value
    : null;
}

function logRenderCompletionFailure(input: {
  renderJob: ProgressRenderJob & { providerRequestId: string | null };
  assetId: string;
  phase: RenderCompletionPhase;
  error: unknown;
  retrying: boolean;
}) {
  const now = Date.now();
  const key = `${input.renderJob.id}:${input.phase}`;
  if (input.retrying && now - (completionFailureLogTimes.get(key) ?? 0) < completionFailureLogIntervalMs) return;
  if (completionFailureLogTimes.size >= maximumCompletionFailureLogEntries) {
    const oldestKey = completionFailureLogTimes.keys().next().value;
    if (oldestKey !== undefined) completionFailureLogTimes.delete(oldestKey);
  }
  completionFailureLogTimes.set(key, now);

  const error = input.error instanceof Error ? input.error : null;
  const fields = input.error && typeof input.error === "object"
    ? input.error as { code?: unknown; status?: unknown }
    : {};
  const nativeBindingUnavailable = error?.message.includes("Could not load the node-av native binding") ?? false;
  const status = input.error instanceof FalApiError ? input.error.status : fields.status;
  const details = {
    sessionId: boundedDiagnosticIdentifier(input.renderJob.sessionId),
    renderJobId: boundedDiagnosticIdentifier(input.renderJob.id),
    providerRequestId: boundedDiagnosticIdentifier(input.renderJob.providerRequestId),
    assetId: boundedDiagnosticIdentifier(input.assetId),
    phase: input.phase,
    errorClass: boundedDiagnosticIdentifier(error?.name) ?? "UnknownError",
    errorCode: nativeBindingUnavailable ? "NATIVE_BINDING_UNAVAILABLE" : boundedDiagnosticIdentifier(fields.code),
    httpStatus: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    retrying: input.retrying
  };
  // Never log error messages/stacks, request bodies, prompts, media URLs or keys.
  if (input.retrying) console.warn("[render-job] completion step will retry", details);
  else console.error("[render-job] completion step failed", details);
}

export function isVideoModerationError(error: unknown) {
  return isFalModerationError(error);
}

export function getVideoProviderFailureCode(error: unknown) {
  return error instanceof FalApiError ? normalizeProviderFailureCode(error.code) : null;
}

export function formatVideoModerationFailureReason(_providerMessage?: string | null) {
  return videoModerationBlockedReason;
}

export async function startVideoRender(input: {
  mode: "seed" | "remix";
  prompt: string;
  sourceVideoUrl?: string | null;
  falApiKey?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  videoModel?: string | null;
}) {
  const started = await startFalVideoRender({
    mode: input.mode,
    prompt: input.prompt,
    sourceVideoUrl: input.sourceVideoUrl,
    apiKey: input.falApiKey ?? env.falApiKey,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    model: input.videoModel
  });
  return { kind: "live" as const, ...started, outputUri: null };
}

type ProgressRenderJob = {
  id: string;
  sessionId: string;
  createdAt: Date;
};

async function reportEstimatedRenderProgress(
  renderJob: ProgressRenderJob,
  status: "queued" | "in_progress"
) {
  const estimate = estimateVideoRenderProgress({
    status,
    createdAt: renderJob.createdAt
  });
  const progress = await recordRenderJobProgress(
    renderJob.sessionId,
    renderJob.id,
    estimate
  );

  return {
    status,
    progress
  };
}

async function reportCompletedRenderProgress(renderJob: ProgressRenderJob) {
  const progress = await recordRenderJobProgress(
    renderJob.sessionId,
    renderJob.id,
    100
  );

  return {
    status: "completed" as const,
    progress
  };
}

export async function reconcileRenderJob(renderJobId: string) {
  const renderJob = await db.renderJob.findUnique({
    where: { id: renderJobId },
    include: { outputAsset: true, session: { include: { playbackState: true } } }
  });
  if (!renderJob || !renderJob.outputAsset) return null;
  if (renderJob.status === "completed") return reportCompletedRenderProgress(renderJob);
  if (renderJob.status === "failed") return { status: "failed" as const, progress: null };

  const age = Date.now() - renderJob.createdAt.getTime();
  const fail = async (reason: string, error?: unknown, retryAllowed = true) => {
    const moderationBlocked = isVideoModerationError(error);
    const result = await failRenderJob(renderJob.id, moderationBlocked ? videoModerationBlockedReason : reason, {
      moderationBlocked,
      providerFailureCode: getVideoProviderFailureCode(error),
      retryAllowed
    });
    return result && result.failed
      ? { status: "failed" as const, progress: null }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  };

  if (!renderJob.providerRequestId) {
    return age < pendingRequestTimeoutMs
      ? reportEstimatedRenderProgress(renderJob, "queued")
      : fail("This clip never received a fal.ai request ID. Check the fal.ai queue before retrying.", undefined, false);
  }
  if (!renderJob.providerStrategy?.startsWith("fal_")) {
    return fail("This job used a retired video provider. Start a new H3 Max clip.");
  }
  if (!env.falApiKey) return fail("H3 Max video generation requires FAL_KEY on the server.", undefined, false);

  let phase: RenderCompletionPhase = "provider_status";
  try {
    let outputUri = renderJob.providerOutputUri;
    if (!outputUri) {
      const task = await retrieveFalVideoStatus(renderJob.providerRequestId, env.falApiKey);
      if (task.status !== "COMPLETED") {
        if (age >= falRecoveryTimeoutMs) return fail("H3 Max has not finished after 30 minutes. Check the fal.ai queue before retrying.", undefined, false);
        const status = task.status === "IN_QUEUE" ? "queued" : "in_progress";
        phase = "save_provider_status";
        await db.renderJob.updateMany({
          where: { id: renderJob.id, status: { in: ["queued", "in_progress"] } },
          data: { status, lastPolledAt: new Date() }
        });
        return reportEstimatedRenderProgress(renderJob, status);
      }
      phase = "provider_result";
      outputUri = await retrieveFalVideoResult(renderJob.providerRequestId, env.falApiKey);
    }

    phase = "save_output_uri";
    const claim = await db.renderJob.updateMany({
      where: { id: renderJob.id, status: { in: ["queued", "in_progress"] } },
      data: { providerOutputUri: outputUri, status: "in_progress", lastPolledAt: new Date() }
    });
    if (claim.count !== 1) return reportEstimatedRenderProgress(renderJob, "in_progress");

    phase = "download_video";
    const buffer = await downloadFalVideo(outputUri);
    phase = "read_video_metadata";
    const metadata = await readVideoMetadata(buffer);
    phase = "persist_video_asset";
    const saved = await persistVideoAsset(renderJob.outputAsset.id, buffer);
    phase = "place_playback_asset";
    const completed = await markRenderJobReady(renderJob.id, renderJob.outputAsset.id, {
      publicUrl: saved.publicUrl,
      storagePath: saved.storagePath,
      thumbnailUrl: saved.thumbnailUrl,
      sourceVideoId: renderJob.providerRequestId,
      ...metadata
    });
    return completed
      ? reportCompletedRenderProgress(renderJob)
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  } catch (error) {
    const retrying = isRetryableFalError(error) && age < falRecoveryTimeoutMs;
    logRenderCompletionFailure({ renderJob, assetId: renderJob.outputAsset.id, phase, error, retrying });
    if (retrying) {
      await db.renderJob.updateMany({
        where: { id: renderJob.id, status: { in: ["queued", "in_progress"] } },
        data: { lastPolledAt: new Date() }
      });
      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }
    return fail(
      error instanceof Error ? error.message : "H3 Max could not complete this clip.",
      error,
      // A retrieval/storage timeout does not mean the generation itself failed.
      !isRetryableFalError(error) && !(error instanceof FalApiError && [401, 403].includes(error.status))
    );
  }
}

export async function failRenderJob(
  renderJobId: string,
  failureReason: string,
  options: {
    moderationBlocked?: boolean;
    providerFailureCode?: string | null;
    forceRetry?: boolean;
    retryAllowed?: boolean;
  } = {}
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    select: {
      id: true,
      outputAssetId: true,
      submissionId: true,
      sessionId: true,
      status: true
    }
  });

  if (!renderJob) {
    return false;
  }

  if (renderJob.status === "failed" || renderJob.status === "completed") {
    return {
      failed: renderJob.status === "failed",
      changed: false,
      moderationBlockCount: 0,
      banned: false
    };
  }

  const previousFailureCount =
    renderJob.submissionId && !options.moderationBlocked
      ? await db.renderJob.count({
          where: {
            submissionId: renderJob.submissionId,
            status: "failed",
            id: {
              not: renderJob.id
            }
          }
        })
      : 0;
  const retryExhausted =
    !options.moderationBlocked &&
    Boolean(renderJob.submissionId) &&
    (options.retryAllowed === false ||
      options.providerFailureCode === "FAL_SUBMISSION_UNKNOWN" ||
      (!options.forceRetry && previousFailureCount >= 1));

  const providerFailureCode = normalizeProviderFailureCode(
    options.providerFailureCode
  );
  const failureClaimed = await db.$transaction(async (tx: any) => {
    const failureClaim = await tx.renderJob.updateMany({
      where: {
        id: renderJob.id,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        status: "failed",
        failureReason,
        providerFailureCode,
        lastPolledAt: new Date()
      }
    });

    if (failureClaim.count !== 1) {
      return false;
    }

    if (renderJob.outputAssetId) {
      await tx.visualAsset.update({
        where: {
          id: renderJob.outputAssetId
        },
        data: {
          status: "failed"
        }
      });
    }

    if (renderJob.submissionId) {
      await tx.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: options.moderationBlocked
            ? "rejected"
            : retryExhausted
              ? "failed"
              : "approved",
          selectedAt: null,
          ...(options.moderationBlocked
            ? {
                approvalReason: videoModerationBlockedReason
              }
            : {})
        }
      });
    }

    return true;
  });

  if (!failureClaimed) {
    return {
      failed: false,
      changed: false,
      moderationBlockCount: 0,
      banned: false
    };
  }

  if (options.moderationBlocked) {
    console.warn("[render-job] provider moderation blocked render", {
      sessionId: renderJob.sessionId,
      renderJobId: renderJob.id,
      providerFailureCode
    });
  }

  return {
    failed: true,
    changed: true,
    moderationBlockCount: 0,
    banned: false
  };
}

async function markRenderJobReady(
  renderJobId: string,
  assetId: string,
  input: {
    publicUrl: string;
    storagePath: string | null;
    thumbnailUrl?: string | null;
    sourceVideoId: string;
    width: number;
    height: number;
    durationSeconds: number;
  }
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    include: {
      session: {
        include: {
          playbackState: true
        }
      },
      submission: true
    }
  });

  const playbackState = renderJob?.session.playbackState;

  if (
    !renderJob ||
    !playbackState ||
    renderJob.status === "completed" ||
    renderJob.status === "failed"
  ) {
    return false;
  }

  const placement = await db.$transaction(async (tx: any) => {
    const completionClaim = await tx.renderJob.updateMany({
      where: {
        id: renderJobId,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        status: "completed",
        failureReason: null,
        completedAt: new Date(),
        lastPolledAt: new Date()
      }
    });

    if (completionClaim.count !== 1) {
      return null;
    }

    await tx.visualAsset.update({
      where: {
        id: assetId
      },
      data: {
        status: "ready",
        publicUrl: input.publicUrl,
        storagePath: input.storagePath,
        ...(input.thumbnailUrl !== undefined
          ? {
              thumbnailUrl: input.thumbnailUrl
            }
          : {}),
        sourceVideoId: input.sourceVideoId,
        width: input.width,
        height: input.height,
        durationSeconds: input.durationSeconds
      }
    });

    const currentClaim = await tx.playbackState.updateMany({
      where: {
        id: playbackState.id,
        currentAssetId: null
      },
      data: {
        currentAssetId: assetId,
        status: "live",
        lastTransitionAt: new Date()
      }
    });
    let placement: "current" | "next" | "backlog" = "backlog";

    if (currentClaim.count === 1) {
      placement = "current";
      await tx.visualAsset.update({
        where: {
          id: assetId
        },
        data: {
          status: "live"
        }
      });
    } else {
      const promotedAssetId = await promoteOldestReadyAsset(renderJob.sessionId, tx, {
        allowArchivedRotation: false
      });

      if (promotedAssetId === assetId) {
        placement = "next";
      }
    }

    if (renderJob.submissionId) {
      await tx.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: placement === "current" ? "live" : "ready"
        }
      });
    }

    return placement;
  });

  if (!placement) {
    return false;
  }

  console.info("[render-job] completed and placed asset", {
    sessionId: renderJob.sessionId,
    renderJobId,
    assetId,
    placement
  });

  return true;
}
