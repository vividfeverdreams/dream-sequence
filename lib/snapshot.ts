import type { PromptSubmission, RankingResult, RenderJob, VisualAsset } from "@prisma/client";
import { db } from "@/lib/db";

export type SessionSnapshot = Awaited<ReturnType<typeof getSessionSnapshot>>;

export async function getSessionSnapshot(sessionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    },
    include: {
      playbackState: {
        include: {
          currentAsset: true,
          nextAsset: true,
          fallbackAsset: true
        }
      },
      submissions: {
        include: {
          moderationResult: true,
          rankingResult: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 10
      },
      renderJobs: {
        include: {
          submission: true,
          outputAsset: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 6
      }
    }
  });

  if (!session) {
    return null;
  }

  const approvedSubmissions = session.submissions.filter((submission) => submission.status === "approved");
  const queuedRender = session.renderJobs.find((job) => job.status === "queued" || job.status === "in_progress");

  return {
    session,
    queueHealth: {
      approvedCount: approvedSubmissions.length,
      queuedRenderCount: session.renderJobs.filter((job) => job.status === "queued").length,
      renderingCount: session.renderJobs.filter((job) => job.status === "in_progress").length,
      readyAssetCount: session.renderJobs.filter((job) => job.status === "completed").length,
      waitingOnRender: Boolean(queuedRender)
    }
  };
}

export type RankedSubmission = PromptSubmission & {
  rankingResult: RankingResult | null;
};

export type PlaybackAsset = VisualAsset | null;

export type RenderWithAsset = RenderJob & {
  outputAsset: VisualAsset | null;
};
