import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";
import {
  canExposeDevVerificationLink,
  createUserVerificationToken,
  getAuthBaseUrl,
  getEmailVerificationUrl
} from "@/lib/email-verification";
import { resendVerificationSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resendVerificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Enter a valid email address."
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

  if (!user || user.emailVerifiedAt) {
    return NextResponse.json({
      ok: true
    });
  }

  const token = await createUserVerificationToken(user.id);
  const verificationUrl = getEmailVerificationUrl(getAuthBaseUrl(request), token);
  const emailResult = await sendVerificationEmail({
    to: user.email,
    displayName: user.displayName,
    verificationUrl
  });

  if (!emailResult.sent && !canExposeDevVerificationLink()) {
    return NextResponse.json(
      {
        error: "Email verification is not configured yet."
      },
      {
        status: 503
      }
    );
  }

  return NextResponse.json({
    ok: true,
    verificationUrl: canExposeDevVerificationLink() ? verificationUrl : undefined
  });
}
