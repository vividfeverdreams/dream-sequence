import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { startDjSession } from "@/lib/session-service";

type StartRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, { params }: StartRouteProps) {
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
  const session = await startDjSession(sessionId, user.id);

  return NextResponse.json({
    id: session.id,
    status: session.status
  });
}
