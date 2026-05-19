import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { profileSchema } from "@/lib/schemas";

export async function PUT(request: Request) {
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
  const parsed = profileSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Enter valid profile details."
      },
      {
        status: 400
      }
    );
  }

  const updatedUser = await db.user.update({
    where: {
      id: user.id
    },
    data: {
      displayName: parsed.data.displayName,
      avatarUrl: parsed.data.avatarUrl || null
    },
    select: {
      email: true,
      displayName: true,
      avatarUrl: true,
      emailVerifiedAt: true
    }
  });

  return NextResponse.json({
    user: {
      ...updatedUser,
      emailVerified: Boolean(updatedUser.emailVerifiedAt)
    }
  });
}
