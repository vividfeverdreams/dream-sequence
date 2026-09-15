import { db } from "@/lib/db";
import {
  getParticipantBlocksRemaining,
  getParticipantModerationBlockCount,
  isParticipantBanned
} from "@/lib/participant-session";
import { isImageModerationFailureReason } from "@/lib/image-moderation";
import {
  getVideoModerationDiagnostic,
  getVideoModerationDiagnosticLabel,
  isVideoModerationFailureReason
} from "@/lib/video-moderation";

export type PublicSubmissionState =
  | "approved"
  | "banned"
  | "blocked"
  | "failed"
  | "queued"
  | "rendering"
  | "ready"
  | "live"
  | "played"
  | "provider-blocked"
  | "rejected"
  | "retrying"
  | "submitted";

export type PublicSubmissionStatus = {
  state: PublicSubmissionState;
  title: string;
  detail: string;
  prompt: string;
  referenceImageUrl?: string;
  moderationBlockCount?: number;
  blocksRemaining?: number;
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

  const intakeImageBlocked = isImageModerationFailureReason(
    submission.approvalReason
  );
  const moderationBlockCount = intakeImageBlocked
    ? await getParticipantModerationBlockCount(
        String(session.id),
        String(submission.senderFingerprint)
      )
    : 0;

  return describeSubmissionStatus(submission, renderJob, moderationBlockCount);
}

function describeSubmissionStatus(
  submission: any,
  renderJob: any,
  moderationBlockCount = 0
): PublicSubmissionStatus {
  const prompt = String(submission.rawText ?? submission.normalizedText ?? "");
  const referenceImageUrl = submission.referenceImageUrl
    ? String(submission.referenceImageUrl)
    : undefined;
  const submittedAt = String(submission.createdAt ?? "");
  const updatedAt = String(submission.updatedAt ?? submission.createdAt ?? "");
  const approvalReason = String(
    submission.rankingResult?.explanation ??
      submission.approvalReason ??
      submission.moderationResult?.explanation ??
      ""
  ).trim();

  if (
    isImageModerationFailureReason(submission.approvalReason)
  ) {
    const banned = isParticipantBanned(moderationBlockCount);
    const blocksRemaining = getParticipantBlocksRemaining(moderationBlockCount);

    return {
      state: banned ? "banned" : "blocked",
      title: banned
        ? "Device locked for this sequence"
        : "Reference image blocked by safety moderation",
      detail: banned
        ? "This was the third reference image blocked by intake moderation, so this device cannot submit again until this live sequence ends."
        : `The image safety filter blocked this submission. ${blocksRemaining} ${
            blocksRemaining === 1 ? "block" : "blocks"
          } remaining before this device is locked for this live sequence.`,
      prompt,
      referenceImageUrl,
      moderationBlockCount,
      blocksRemaining,
      submittedAt,
      updatedAt
    };
  }

  if (isVideoModerationFailureReason(renderJob?.failureReason)) {
    const diagnostic =
      getVideoModerationDiagnostic(renderJob?.providerFailureCode) ??
      "provider_safety";

    return {
      state: "provider-blocked",
      title: "Video provider could not render this remix",
      detail: `${getVideoModerationDiagnosticLabel(diagnostic)} This provider-side failure did not count against your device.`,
      prompt,
      referenceImageUrl,
      submittedAt,
      updatedAt
    };
  }

  if (submission.status === "rejected") {
    return {
      state: "rejected",
      title: "Not approved for the queue",
      detail:
        approvalReason ||
        "The venue-safe filter rejected this remix, so it will not be sent to the screen.",
      prompt,
      referenceImageUrl,
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
      referenceImageUrl,
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
      referenceImageUrl,
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
      referenceImageUrl,
      submittedAt,
      updatedAt
    };
  }

  if (submission.status === "failed") {
    return {
      state: "failed",
      title: "This idea could not become a video",
      detail:
        renderJob?.providerFailureCode === "FAL_SUBMISSION_UNKNOWN"
          ? "The video service did not confirm this request. Automatic retries have stopped to avoid duplicate videos."
          : "Video generation failed and automatic retries have stopped. You can submit another idea.",
      prompt,
      referenceImageUrl,
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
      referenceImageUrl,
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
      referenceImageUrl,
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
      referenceImageUrl,
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
      referenceImageUrl,
      submittedAt,
      updatedAt
    };
  }

  return {
    state: "submitted",
    title: "Received",
    detail: "The remix text landed in the system and is being scored now.",
    prompt,
    referenceImageUrl,
    submittedAt,
    updatedAt
  };
}
