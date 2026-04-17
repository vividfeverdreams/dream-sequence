import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

type SessionPayload = {
  userId: string;
  email: string;
  exp: number;
};

function toBase64Url(value: Buffer | string) {
  const source = typeof value === "string" ? Buffer.from(value) : value;
  return source.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", env.authSecret).update(payload).digest("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const derived = pbkdf2Sync(password, salt, 120_000, 32, "sha256");
  const expected = Buffer.from(hash, "hex");

  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">) {
  const completePayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  };

  const encoded = toBase64Url(JSON.stringify(completePayload));
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function parseSessionToken(token: string): SessionPayload | null {
  const [encoded, signature] = token.split(".");

  if (!encoded || !signature) {
    return null;
  }

  const expected = signPayload(encoded);
  const valid =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!valid) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encoded).toString()) as SessionPayload;

    if (payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
