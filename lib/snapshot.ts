import type { PromptSubmission, RankingResult, RenderJob, VisualAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { canRecoverSeedRender, recoverableSeedFailureMessage } from "@/lib/seed-render-recovery";
import { estimateVideoRenderProgress } from "@/lib/render-progress";
import {
  getStoredRenderProgress,
  renderProgressEventPrefix
} from "@/lib/render-progress-state";
import { getShowOverlaySettings, showOverlayEventTypes } from "@/lib/show-overlay-state";
import {
  getVideoModerationDiagnostic,
  isVideoModerationFailureReason,
  videoModerationBlockedReason,
  videoProviderFailureReason
} from "@/lib/video-moderation";

const clientSourceSubmissionSelect = {
  rawText: true,
  sender: true,
  source: true,
  referenceImageUrl: true
} as const;

const clientVisualAssetSelect = {
  id: true,
  kind: true,
  title: true,
  promptText: true,
  publicUrl: true,
  status: true,
  createdAt: true,
  sourceSubmission: {
    select: clientSourceSubmissionSelect
  }
} as const;

export type SessionSnapshot = Awaited<ReturnType<typeof getSessionSnapshot>>;

export async function getSessionSnapshot(sessionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    },
    include: {
      playbackState: {
        include: {
          currentAsset: {
            select: clientVisualAssetSelect
          },
          nextAsset: {
            select: clientVisualAssetSelect
          },
          fallbackAsset: {
            select: clientVisualAssetSelect
          }
        }
      },
      submissions: {
        select: {
          id: true,
          source: true,
          sender: true,
          rawText: true,
          referenceImageUrl: true,
          status: true,
          approvalReason: true,
          createdAt: true,
          rankingResult: {
            select: {
              score: true,
              winningPrompt: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 10
      },
      renderJobs: {
        select: {
          id: true,
          mode: true,
          status: true,
          promptText: true,
          failureReason: true,
          providerFailureCode: true,
          submissionId: true,
          providerStrategy: true,
          providerRequestId: true,
          providerOutputUri: true,
          outputAsset: { select: { status: true } },
          createdAt: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 6
      },
      visualAssets: {
        where: {
          publicUrl: {
            not: null
          },
          status: {
            in: ["ready", "live", "archived"]
          }
        },
        select: clientVisualAssetSelect,
        orderBy: {
          createdAt: "desc"
        },
        take: 50
      },
      auditEvents: {
        where: {
          OR: [
            {
              type: {
                in: [...showOverlayEventTypes]
              }
            },
            {
              type: {
                startsWith: renderProgressEventPrefix
              }
            }
          ]
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 100
      }
    }
  });

  if (!session) {
    return null;
  }

  const approvedSubmissions = session.submissions.filter((submission: any) => submission.status === "approved");
  const queuedRender = session.renderJobs.find((job: any) => job.status === "queued" || job.status === "in_progress");
  const { auditEvents: showOverlayEvents, ...snapshotSession } = session;
  const showOverlaySettings = getShowOverlaySettings(showOverlayEvents);
  const latestSeedId = snapshotSession.renderJobs.find((job) => job.mode === "seed")?.id;
  const renderJobs = snapshotSession.renderJobs.map((job) => {
    const canRecover = job.id === latestSeedId && canRecoverSeedRender(job);
    const storedProgress = getStoredRenderProgress(showOverlayEvents, job.id);
    const progress =
      job.status === "queued" || job.status === "in_progress"
        ? estimateVideoRenderProgress({
            status: job.status,
            createdAt: job.createdAt,
            previousProgress: storedProgress ?? 0
          })
        : storedProgress;

    return {
      id: job.id,
      mode: job.mode,
      status: job.status,
      promptText: job.promptText,
      canRecover,
      failureReason: canRecover
        ? recoverableSeedFailureMessage
        : isVideoModerationFailureReason(job.failureReason)
        ? videoModerationBlockedReason
        : job.status === "failed" && job.failureReason
          ? videoProviderFailureReason
          : job.failureReason,
      moderationDiagnostic: getVideoModerationDiagnostic(
        job.providerFailureCode
      ),
      createdAt: job.createdAt,
      progress
    };
  });
  const playbackState = snapshotSession.playbackState
    ? {
        ...snapshotSession.playbackState,
        currentAsset: serializeClientVisualAsset(snapshotSession.playbackState.currentAsset),
        nextAsset: serializeClientVisualAsset(snapshotSession.playbackState.nextAsset),
        fallbackAsset: serializeClientVisualAsset(snapshotSession.playbackState.fallbackAsset)
      }
    : null;
  const submissions = snapshotSession.submissions.map(serializeClientSubmission);
  const visualAssets = snapshotSession.visualAssets.map((asset) =>
    serializeClientVisualAsset(asset)!
  );

  return {
    session: {
      ...snapshotSession,
      playbackState,
      submissions,
      renderJobs,
      visualAssets,
      ...showOverlaySettings
    },
    queueHealth: {
      approvedCount: approvedSubmissions.length,
      queuedRenderCount: session.renderJobs.filter((job: any) => job.status === "queued").length,
      renderingCount: session.renderJobs.filter((job: any) => job.status === "in_progress").length,
      readyAssetCount: session.renderJobs.filter((job: any) => job.status === "completed").length,
      waitingOnRender: Boolean(queuedRender)
    }
  };
}

type ClientSourceSubmission = {
  rawText: string;
  sender: string | null;
  source: string;
  referenceImageUrl: string | null;
};

type ClientVisualAsset = {
  id: string;
  kind: string;
  title: string;
  promptText: string;
  publicUrl: string | null;
  status: string;
  createdAt: Date;
  sourceSubmission: ClientSourceSubmission | null;
};

type ClientSubmission = {
  id: string;
  source: string;
  sender: string | null;
  rawText: string;
  referenceImageUrl: string | null;
  status: string;
  approvalReason: string | null;
  createdAt: Date;
  rankingResult: {
    score: number;
    winningPrompt: string;
  } | null;
};

function serializeClientSourceSubmission(submission: ClientSourceSubmission | null) {
  if (!submission) {
    return null;
  }

  return {
    rawText: submission.rawText,
    sender: ["web", "twitch"].includes(submission.source) ? submission.sender : null,
    source: submission.source,
    referenceImageUrl: submission.referenceImageUrl
  };
}

function serializeClientVisualAsset(asset: ClientVisualAsset | null) {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    promptText: asset.promptText,
    publicUrl: asset.publicUrl,
    status: asset.status,
    createdAt: asset.createdAt,
    sourceSubmission: serializeClientSourceSubmission(asset.sourceSubmission)
  };
}

function serializeClientSubmission(submission: ClientSubmission) {
  return {
    id: submission.id,
    source: submission.source,
    sender: ["web", "twitch"].includes(submission.source) ? submission.sender : null,
    rawText: submission.rawText,
    referenceImageUrl: submission.referenceImageUrl,
    status: submission.status,
    approvalReason: submission.approvalReason,
    createdAt: submission.createdAt,
    rankingResult: submission.rankingResult
      ? {
          score: submission.rankingResult.score,
          winningPrompt: submission.rankingResult.winningPrompt
        }
      : null
  };
}

export type RankedSubmission = PromptSubmission & {
  rankingResult: RankingResult | null;
};

export type PlaybackAsset = VisualAsset | null;

export type RenderWithAsset = RenderJob & {
  outputAsset: VisualAsset | null;
};
