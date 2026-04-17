import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reconcilePendingRenderJobs } from "@/lib/submission-pipeline";

type ReconcileRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, { params }: ReconcileRouteProps) {
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

  const { sessionId } = await params;
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      {
        error: "Session not found."
      },
      {
        status: 404
      }
    );
  }

  const count = await reconcilePendingRenderJobs(sessionId);

  return NextResponse.json({
    ok: true,
    count
  });
}
