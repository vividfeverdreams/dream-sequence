import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";
import {
  canExposeDevVerificationLink,
  createUserVerificationToken,
  getAuthBaseUrl,
  getEmailVerificationUrl
} from "@/lib/email-verification";
import { hashPassword } from "@/lib/auth-core";
import { signupSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Enter your name, a valid email, and matching passwords."
      },
      {
        status: 400
      }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existingUser = await db.user.findUnique({
    where: {
      email
    }
  });

  if (existingUser?.emailVerifiedAt) {
    return NextResponse.json(
      {
        error: "An account already exists for this email. Sign in instead."
      },
      {
        status: 409
      }
    );
  }

  const passwordHash = hashPassword(parsed.data.password);
  const user =
    existingUser ??
    (await db.user.create({
      data: {
        email,
        passwordHash,
        displayName: parsed.data.displayName,
        emailVerifiedAt: null
      }
    }));

  if (existingUser) {
    await db.user.update({
      where: {
        id: existingUser.id
      },
      data: {
        displayName: parsed.data.displayName,
        passwordHash
      }
    });
  }

  const token = await createUserVerificationToken(user.id);
  const verificationUrl = getEmailVerificationUrl(getAuthBaseUrl(request), token);
  const emailResult = await sendVerificationEmail({
    to: email,
    displayName: parsed.data.displayName,
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
    email,
    verificationUrl: canExposeDevVerificationLink() ? verificationUrl : undefined
  });
}
