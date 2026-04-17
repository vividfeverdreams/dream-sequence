import { NextResponse } from "next/server";
import { completePlaybackTransition } from "@/lib/session-service";
import { attemptAutomatedSelection } from "@/lib/submission-pipeline";

type TransitionRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, { params }: TransitionRouteProps) {
  const { sessionId } = await params;
  await completePlaybackTransition(sessionId);
  await attemptAutomatedSelection(sessionId);

  return NextResponse.json({
    ok: true
  });
}
