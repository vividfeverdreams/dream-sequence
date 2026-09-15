import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  initialGenerationQueueFailureMessage,
  initialGenerationRecoveryFailureMessage,
  startDjSession
} from "@/lib/session-service";

export const maxDuration = 300;

type StartRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, { params }: StartRouteProps) {
  const { sessionId } = await params;

  try {
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

    const session = await startDjSession(sessionId, user.id);

    console.info("[session-start] completed", {
      sessionId,
      status: session.status
    });

    return NextResponse.json({
      id: session.id,
      status: session.status
    });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Unknown session start error";

    console.error("[session-start] failed", {
      sessionId,
      failureReason
    });

    return NextResponse.json(
      {
        error:
          [initialGenerationQueueFailureMessage, initialGenerationRecoveryFailureMessage].includes(failureReason)
            ? failureReason
            : "Could not start the session. Retry in a moment."
      },
      {
        status: 500
      }
    );
  }
}
