import { subMinutes } from "@/lib/time";
import { db } from "@/lib/db";

type RateLimitCheck = {
  allowed: boolean;
  reason?: string;
};

export async function checkSubmissionRateLimit(
  sessionId: string,
  senderFingerprint: string,
  submissionLimit: number | null
): Promise<RateLimitCheck> {
  if (submissionLimit === null) {
    return {
      allowed: true
    };
  }

  const tenMinutesAgo = subMinutes(new Date(), 10);

  const recentCount = await db.promptSubmission.count({
    where: {
      sessionId,
      senderFingerprint,
      createdAt: {
        gte: tenMinutesAgo
      }
    }
  });

  if (recentCount >= submissionLimit) {
    const remixLabel = submissionLimit === 1 ? "idea" : "ideas";

    return {
      allowed: false,
      reason: `You have already sent ${submissionLimit} ${remixLabel} in the last ten minutes.`
    };
  }

  return {
    allowed: true
  };
}
