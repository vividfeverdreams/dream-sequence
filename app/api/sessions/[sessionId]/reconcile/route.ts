import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseAudioSyncRelayToken } from "@/lib/audio-sync-relay-token";
import { db } from "@/lib/db";
import { drainPendingTwitchEvents } from "@/lib/twitch";
import { reconcilePendingRenderJobs } from "@/lib/submission-pipeline";

export const maxDuration = 300;

type ReconcileRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, { params }: ReconcileRouteProps) {
  const { sessionId } = await params;
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const relayPayload = token ? parseAudioSyncRelayToken(token) : null;
  const user = await getCurrentUser();
  const authorizedUserId =
    relayPayload?.sessionId === sessionId ? relayPayload.userId : (user?.id ?? null);

  if (!authorizedUserId) {
    console.warn("[render-reconcile] authorization rejected", {
      sessionId,
      reason: "missing-or-invalid-session-credentials"
    });
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId: authorizedUserId
    }
  });

  if (!session) {
    console.warn("[render-reconcile] authorization rejected", {
      sessionId,
      reason: "session-not-owned"
    });
    return NextResponse.json(
      {
        error: "Session not found."
      },
      {
        status: 404
      }
    );
  }

  if (session.audienceMode === "twitch") {
    after(async () => {
      try {
        await drainPendingTwitchEvents({ userId: authorizedUserId, limit: 5 });
      } catch (error) {
        console.warn("[render-reconcile] Twitch intake will retry", {
          sessionId,
          errorClass: error instanceof Error ? error.name : "UnknownError"
        });
      }
    });
  }
  const jobs = await reconcilePendingRenderJobs(sessionId);

  return NextResponse.json({
    ok: true,
    count: jobs.length,
    jobs
  });
}
