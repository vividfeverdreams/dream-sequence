import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assessSubmission } from "@/lib/ai-assessment";
import { generateStoryContinuationPrompt } from "@/lib/story-continuation-prompt";
import { hashValue, normalizePromptText } from "@/lib/utils";

export const storyContinuationIntervalMs = 60_000;
export const automaticSubmissionSource = "automatic";
export const storyInputReceivedEvent = "story.input_received";

async function hasPendingTwitchInput(
  tx: Prisma.TransactionClient,
  session: { audienceMode: string; userId: string }
) {
  if (session.audienceMode !== "twitch") return false;
  const connection = await tx.twitchConnection.findUnique({
    where: { userId: session.userId }, select: { twitchUserId: true }
  });
  if (!connection) return false;
  return Boolean(await tx.twitchEventDelivery.findFirst({
    where: {
      channelId: connection.twitchUserId,
      status: { in: ["pending", "processing"] },
      OR: [{ attempts: { lt: 5 } }, { status: "processing", leaseUntil: { gt: new Date() } }]
    },
    select: { id: true }
  }));
}

// The saved draft is both a durable timer and a claim shared by all dashboards
// and scheduled workers. No process-local timer or database migration is needed.
export async function createIdleStoryContinuation(sessionId: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - storyContinuationIntervalMs);
  const claimed = await db.$transaction(async (tx) => {
    const session = await tx.dJSession.findUnique({
      where: { id: sessionId },
      include: {
        playbackState: { include: { currentAsset: true } },
        submissions: { orderBy: { createdAt: "desc" }, take: 1 },
        auditEvents: { where: { type: storyInputReceivedEvent }, orderBy: { createdAt: "desc" }, take: 1 },
        renderJobs: { where: { status: { in: ["queued", "in_progress"] } }, take: 1 },
        visualAssets: { where: { status: "ready", publicUrl: { not: null } }, take: 1 }
      }
    });
    if (!session || session.status !== "live" || !session.autoSelectEnabled ||
        !session.startedAt || !session.playbackState || session.playbackState.emergencyPaused ||
        !session.playbackState.currentAsset?.publicUrl ||
        session.renderJobs.length || session.visualAssets.length) return null;

    const lastActivityAt = Math.max(
      session.startedAt.getTime(),
      session.submissions[0]?.createdAt.getTime() ?? 0,
      session.auditEvents[0]?.createdAt.getTime() ?? 0
    );
    if (now.getTime() - lastActivityAt < storyContinuationIntervalMs) return null;

    // A worker interrupted during its bounded text request must not leave a
    // permanent pending draft behind. Never reclaim a draft younger than a minute.
    await tx.promptSubmission.updateMany({
      where: { sessionId, source: automaticSubmissionSource, status: "submitted", createdAt: { lte: cutoff } },
      data: { status: "failed", approvalReason: "Automatic continuation was interrupted; a new attempt can follow." }
    });
    const pendingInput = await tx.promptSubmission.findFirst({
      where: { sessionId, status: { in: ["submitted", "approved"] } },
      select: { id: true }
    });
    if (pendingInput || await hasPendingTwitchInput(tx, session)) return null;

    const lease = await tx.dJSession.updateMany({
      where: { id: sessionId, updatedAt: session.updatedAt },
      data: { updatedAt: new Date(Math.max(now.getTime(), session.updatedAt.getTime() + 1)) }
    });
    if (lease.count !== 1) return null;

    const submission = await tx.promptSubmission.create({
      data: {
        sessionId,
        source: automaticSubmissionSource,
        senderFingerprint: hashValue(`automatic:${sessionId}`),
        messageSid: `automatic:${sessionId}:${lastActivityAt}`,
        rawText: "The story is continuing automatically…",
        normalizedText: "The story is continuing automatically…",
        status: "submitted",
        createdAt: now
      }
    });
    return { session, submission, lastActivityAt };
  });
  if (!claimed) return null;

  const { session, submission, lastActivityAt } = claimed;
  try {
    const [recentClips, continuationNumber] = await Promise.all([
      db.renderJob.findMany({
        where: { sessionId, status: "completed" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 6,
        select: { promptText: true, submission: { select: { rawText: true } } }
      }),
      db.promptSubmission.count({ where: { sessionId, source: automaticSubmissionSource } })
    ]);
    const recentPrompts = recentClips.reverse().map((clip) => clip.submission?.rawText || clip.promptText);
    if (!recentPrompts.length) recentPrompts.push(session.playbackState!.currentAsset!.promptText);
    const creativeContext = {
      userId: session.userId,
      artistName: session.artistName,
      trackName: session.trackName,
      basePrompt: session.basePrompt,
      creativeBible: session.creativeBible,
      allowedMotifs: session.allowedMotifs,
      bannedTerms: session.bannedTerms,
      colorPalette: session.colorPalette,
      motionRules: session.motionRules,
      artistControlEnabled: session.artistControlEnabled,
      venueSafeMode: session.venueSafeMode
    };
    const prompt = await generateStoryContinuationPrompt({ session: creativeContext, recentPrompts, continuationNumber });
    const assessment = await assessSubmission({
      submissionText: prompt,
      session: creativeContext,
      recentWinningPrompts: recentPrompts
    });

    return await db.$transaction(async (tx) => {
      // Audience input arriving while text generation runs takes priority. Pause,
      // stop and a resumed/restarted session also invalidate the old draft.
      const stillIdle = await tx.dJSession.findFirst({
        where: {
          id: sessionId, status: "live", autoSelectEnabled: true, startedAt: session.startedAt,
          playbackState: { is: { emergencyPaused: false } },
          auditEvents: { none: { type: storyInputReceivedEvent, createdAt: { gt: new Date(lastActivityAt) } } },
          submissions: { none: {
            source: { not: automaticSubmissionSource },
            OR: [
              { createdAt: { gt: new Date(lastActivityAt) } },
              { status: { in: ["submitted", "approved"] } }
            ]
          } }
        },
        select: { id: true }
      });
      const newTwitchInput = stillIdle && await hasPendingTwitchInput(tx, session);
      const approved = Boolean(stillIdle) && !newTwitchInput && assessment.decision === "approved";
      const approvalReason = !stillIdle || newTwitchInput
        ? "Automatic continuation skipped because new input arrived or the session was paused."
        : assessment.approvalReason;
      const saved = await tx.promptSubmission.updateMany({
        where: { id: submission.id, status: "submitted" },
        data: {
          rawText: prompt, normalizedText: normalizePromptText(prompt),
          status: approved ? "approved" : "rejected", approvalReason
        }
      });
      if (saved.count !== 1) return null;
      await tx.moderationResult.create({ data: {
        submissionId: submission.id, decision: assessment.decision,
        score: assessment.score, flags: JSON.stringify(assessment.flags), explanation: assessment.explanation
      } });
      await tx.rankingResult.create({ data: {
        submissionId: submission.id, score: assessment.score,
        noveltyScore: assessment.noveltyScore, cohesionScore: assessment.cohesionScore,
        remixDeltaScore: assessment.remixDeltaScore, winningPrompt: assessment.winningPrompt,
        explanation: approvalReason
      } });
      return approved ? { id: submission.id, prompt: assessment.winningPrompt } : null;
    });
  } catch (error) {
    await db.promptSubmission.updateMany({
      where: { id: submission.id, status: "submitted" },
      data: { status: "failed", approvalReason: "Automatic continuation could not be prepared. It will retry after a minute." }
    });
    console.warn("[story-continuation] preparation will retry", {
      sessionId, errorClass: error instanceof Error ? error.name : "UnknownError"
    });
    return null;
  }
}
