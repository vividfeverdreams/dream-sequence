import { NextResponse } from "next/server";
import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { passwordUpdateSchema } from "@/lib/schemas";

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
  const parsed = passwordUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Enter a valid password."
      },
      {
        status: 400
      }
    );
  }

  if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return NextResponse.json(
      {
        error: "Current password is incorrect."
      },
      {
        status: 401
      }
    );
  }

  await db.user.update({
    where: {
      id: user.id
    },
    data: {
      passwordHash: hashPassword(parsed.data.newPassword)
    },
    select: {
      id: true
    }
  });

  return NextResponse.json({
    ok: true
  });
}
