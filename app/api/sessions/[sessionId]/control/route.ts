import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  forceTransitionToNext,
  queueFallbackRemix,
  setSelectionPause,
  stopDjSession
} from "@/lib/session-service";
import { attemptAutomatedSelection } from "@/lib/submission-pipeline";
import { controlSchema } from "@/lib/schemas";

type ControlRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, { params }: ControlRouteProps) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = controlSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Unknown control action."
      },
      {
        status: 400
      }
    );
  }

  const { sessionId } = await params;

  switch (parsed.data.action) {
    case "pause-selection":
      await setSelectionPause(sessionId, user.id, true);
      break;
    case "resume-selection":
      await setSelectionPause(sessionId, user.id, false);
      await attemptAutomatedSelection(sessionId);
      break;
    case "skip-next":
      await forceTransitionToNext(sessionId, user.id, parsed.data.transitionSeconds ?? 0);
      await attemptAutomatedSelection(sessionId);
      break;
    case "fallback-remix":
      await queueFallbackRemix(sessionId, user.id);
      break;
    case "stop-session":
      await stopDjSession(sessionId, user.id);
      break;
  }

  return NextResponse.json({
    ok: true
  });
}
