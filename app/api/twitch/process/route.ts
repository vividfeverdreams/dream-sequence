import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reconcilePendingRenderJobs } from "@/lib/submission-pipeline";
import { drainPendingTwitchEvents, validateTwitchConnections } from "@/lib/twitch";
import { equalTwitchSecret, isTwitchConfigured } from "@/lib/twitch-security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equalTwitchSecret(request.headers.get("authorization") || "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const configured = isTwitchConfigured();
  let processed = 0;
  const twitchErrors: string[] = [];

  // Token validation can span many channels. Start it independently so a slow
  // validation batch cannot consume the runtime before active stories progress.
  const validationPromise = (async () => {
    if (!configured) return undefined;
    try {
      return await validateTwitchConnections();
    } catch (error) {
      twitchErrors.push("validation");
      logMaintenanceError("twitch-validation", error);
      return undefined;
    }
  })();

  if (configured) {
    // Save waiting audience ideas before deciding whether the story is idle.
    try {
      ({ processed } = await drainPendingTwitchEvents({ limit: 10 }));
    } catch (error) {
      twitchErrors.push("intake");
      logMaintenanceError("twitch-intake", error);
    }
  }

  const sessions = await db.dJSession.findMany({
    where: {
      status: "live",
      autoSelectEnabled: true,
      playbackState: { is: { emergencyPaused: false } }
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: { id: true, updatedAt: true },
    take: 10
  });
  const results = await Promise.all(sessions.map(async (session) => {
    try {
      // Rotate every attempted session through this bounded batch, including
      // sessions waiting on slow renders or failing providers. The timestamp
      // comparison also prevents overlapping cron runs claiming the same batch.
      const claim = await db.dJSession.updateMany({
        where: {
          id: session.id,
          updatedAt: session.updatedAt,
          status: "live",
          autoSelectEnabled: true,
          playbackState: { is: { emergencyPaused: false } }
        },
        data: {
          updatedAt: new Date(Math.max(Date.now(), session.updatedAt.getTime() + 1))
        }
      });

      if (claim.count !== 1) return "skipped";

      await reconcilePendingRenderJobs(session.id);
      return "reconciled";
    } catch (error) {
      logMaintenanceError("story-reconciliation", error, session.id);
      return "failed";
    }
  }));
  const validation = await validationPromise;

  return NextResponse.json({
    configured,
    processed,
    ...(validation === undefined ? {} : { validation }),
    ...(twitchErrors.length ? { twitchErrors } : {}),
    stories: {
      checked: sessions.length,
      reconciled: results.filter((result) => result === "reconciled").length,
      failed: results.filter((result) => result === "failed").length
    }
  });
}

function logMaintenanceError(operation: string, error: unknown, sessionId?: string) {
  console.warn("[story-maintenance] operation will retry", {
    operation,
    ...(sessionId ? { sessionId } : {}),
    errorClass: error instanceof Error ? error.name : "UnknownError"
  });
}
