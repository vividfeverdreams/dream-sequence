import { NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth-core";
import { getLoginCookie } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashEmailVerificationToken } from "@/lib/email-verification";

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return redirectTo(request, "/login?verified=invalid");
  }

  const tokenHash = hashEmailVerificationToken(token);
  const verificationToken = await db.emailVerificationToken.findUnique({
    where: {
      tokenHash
    }
  });

  if (
    !verificationToken ||
    verificationToken.usedAt ||
    new Date(String(verificationToken.expiresAt)).getTime() < Date.now()
  ) {
    return redirectTo(request, "/login?verified=invalid");
  }

  const user = await db.user.findUnique({
    where: {
      id: verificationToken.userId
    }
  });

  if (!user) {
    return redirectTo(request, "/login?verified=invalid");
  }

  await db.$transaction(async (tx: typeof db) => {
    await tx.user.update({
      where: {
        id: user.id
      },
      data: {
        emailVerifiedAt: new Date()
      }
    });
    await tx.emailVerificationToken.update({
      where: {
        tokenHash
      },
      data: {
        usedAt: new Date()
      }
    });
    await tx.auditEvent.create({
      data: {
        userId: user.id,
        type: "account.email_verified",
        summary: "User verified their email address."
      }
    });
  });

  const sessionToken = createSessionToken({
    userId: user.id,
    email: user.email
  });
  const response = redirectTo(request, "/sessions?verified=1");
  response.cookies.set(getLoginCookie(sessionToken));
  return response;
}
