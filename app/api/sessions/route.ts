import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createDjSession } from "@/lib/session-service";
import { sessionFormSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "You need to log in first."
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = sessionFormSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Session details are incomplete."
      },
      {
        status: 400
      }
    );
  }

  if (parsed.data.audienceSlug) {
    const existingSession = await db.dJSession.findUnique({
      where: {
        code: parsed.data.audienceSlug
      }
    });

    if (existingSession) {
      return NextResponse.json(
        {
          error: "That audience URL is already taken."
        },
        {
          status: 409
        }
      );
    }
  }

  const session = await createDjSession(user.id, {
    ...parsed.data,
    imageReferenceUrl: parsed.data.imageReferenceUrl || undefined
  });

  return NextResponse.json({
    id: session.id,
    code: session.code
  });
}
