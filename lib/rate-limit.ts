import { subMinutes } from "@/lib/time";
import { db } from "@/lib/db";

type RateLimitCheck = {
  allowed: boolean;
  reason?: string;
};

export async function checkSubmissionRateLimit(sessionId: string, senderFingerprint: string): Promise<RateLimitCheck> {
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

  if (recentCount >= 3) {
    return {
      allowed: false,
      reason: "That device has already sent three remixes in the last ten minutes."
    };
  }

  return {
    allowed: true
  };
}
