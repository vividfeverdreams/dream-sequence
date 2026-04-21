import { db } from "@/lib/db";

export type PublicSubmissionState =
  | "approved"
  | "queued"
  | "rendering"
  | "ready"
  | "live"
  | "played"
  | "rejected"
  | "retrying"
  | "submitted";

export type PublicSubmissionStatus = {
  state: PublicSubmissionState;
  title: string;
  detail: string;
  prompt: string;
  submittedAt: string;
  updatedAt: string;
};

export async function getPublicSubmissionStatus(sessionCode: string, submissionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      code: sessionCode
    }
  });

  if (!session) {
    return null;
  }

  const submission = await db.promptSubmission.findUnique({
    where: {
      id: submissionId
    },
    include: {
      rankingResult: true,
      moderationResult: true
    }
  });

  if (!submission || String(submission.sessionId) !== String(session.id)) {
    return null;
  }

  const renderJob = (
    await db.renderJob.findMany({
      where: {
        submissionId: submission.id
      },
      include: {
        outputAsset: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 1
    })
  )[0];

  return describeSubmissionStatus(submission, renderJob);
}

function describeSubmissionStatus(submission: any, renderJob: any): PublicSubmissionStatus {
  const prompt = String(submission.rawText ?? submission.normalizedText ?? "");
  const submittedAt = String(submission.createdAt ?? "");
  const updatedAt = String(submission.updatedAt ?? submission.createdAt ?? "");
  const approvalReason = String(
    submission.rankingResult?.explanation ??
      submission.approvalReason ??
      submission.moderationResult?.explanation ??
      ""
  ).trim();

  if (submission.status === "rejected") {
    return {
      state: "rejected",
      title: "Not approved for the queue",
      detail:
        approvalReason ||
        "The venue-safe filter rejected this remix, so it will not be sent to the screen.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (renderJob?.outputAsset?.status === "live" || submission.status === "live") {
    return {
      state: "live",
      title: "Live on screen",
      detail: "This remix made it through and is currently playing in the show.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (renderJob?.outputAsset?.status === "archived") {
    return {
      state: "played",
      title: "Played earlier",
      detail: "This remix already hit the screen and has now rolled into the archive.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (renderJob?.outputAsset?.status === "ready" || submission.status === "ready") {
    return {
      state: "ready",
      title: "Ready for transition",
      detail: "The remix finished rendering and is loaded as a candidate for the next crossfade.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (renderJob?.status === "in_progress" || renderJob?.status === "queued") {
    return {
      state: "rendering",
      title: "Rendering now",
      detail: "The DJ system picked this remix and is rendering the next visual loop right now.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (renderJob?.status === "failed") {
    return {
      state: submission.status === "approved" ? "retrying" : "queued",
      title:
        submission.status === "approved"
          ? "Approved and waiting for another try"
          : "Waiting for another render slot",
      detail:
        submission.status === "approved"
          ? "A render attempt failed, but the remix is still approved and can be selected again."
          : "A render attempt did not finish, so the queue is waiting for another pass.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (submission.status === "queued") {
    return {
      state: "queued",
      title: "Chosen for the queue",
      detail: "The DJ system picked this remix. It is next in line for rendering.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  if (submission.status === "approved") {
    return {
      state: "approved",
      title: "Approved and waiting",
      detail:
        approvalReason ||
        "The remix passed venue-safe scoring and is waiting for an open render slot.",
      prompt,
      submittedAt,
      updatedAt
    };
  }

  return {
    state: "submitted",
    title: "Received",
    detail: "The remix text landed in the system and is being scored now.",
    prompt,
    submittedAt,
    updatedAt
  };
}
