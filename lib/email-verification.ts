import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

const verificationTokenLifetimeMs = 1000 * 60 * 60 * 24;

export function createEmailVerificationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashEmailVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getEmailVerificationUrl(baseUrl: string, token: string) {
  const url = new URL("/api/auth/verify", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function createUserVerificationToken(userId: string) {
  const token = createEmailVerificationToken();
  const tokenHash = hashEmailVerificationToken(token);
  const expiresAt = new Date(Date.now() + verificationTokenLifetimeMs);

  await db.emailVerificationToken.updateMany({
    where: {
      userId,
      usedAt: null
    },
    data: {
      usedAt: new Date()
    }
  });

  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return token;
}

export function getAuthBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

export function canExposeDevVerificationLink() {
  return process.env.NODE_ENV !== "production" || process.env.AUTH_EMAIL_DEV_MODE === "true";
}
