import { NextResponse } from "next/server";
import { getLoginCookie } from "@/lib/auth";
import { createSessionToken, verifyPassword } from "@/lib/auth-core";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Enter a valid email and password."
      },
      {
        status: 400
      }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({
    where: {
      email
    }
  });

  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json(
      {
        error: "Incorrect email or password."
      },
      {
        status: 401
      }
    );
  }

  if (!user.emailVerifiedAt) {
    return NextResponse.json(
      {
        error: "Verify your email before signing in.",
        code: "EMAIL_UNVERIFIED"
      },
      {
        status: 403
      }
    );
  }

  const token = createSessionToken({
    userId: user.id,
    email: user.email
  });

  const response = NextResponse.json({
    ok: true
  });
  response.cookies.set(getLoginCookie(token));
  return response;
}
