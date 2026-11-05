import { describe, expect, it, vi } from "vitest";
import {
  createPasswordStamp,
  createSessionToken,
  hashPassword,
  isSessionCurrent,
  parseSessionToken,
  verifyPassword
} from "@/lib/auth-core";

describe("auth helpers", () => {
  it("hashes and verifies passwords", () => {
    const password = "test-password-123";
    const hash = hashPassword(password);

    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("creates verifiable session tokens", () => {
    const token = createSessionToken({
      userId: "user_123",
      email: "dj@example.com",
      passwordStamp: createPasswordStamp("salt:hash")
    });

    const parsed = parseSessionToken(token);

    expect(parsed?.userId).toBe("user_123");
    expect(parsed?.email).toBe("dj@example.com");
  });

  it("ends a session when the password changes", () => {
    const oldHash = hashPassword("old-password-123");
    const newHash = hashPassword("new-password-456");
    const token = createSessionToken({
      userId: "user_123",
      email: "dj@example.com",
      passwordStamp: createPasswordStamp(oldHash)
    });
    const parsed = parseSessionToken(token);

    expect(parsed).not.toBeNull();
    expect(isSessionCurrent(parsed!, oldHash)).toBe(true);
    expect(isSessionCurrent(parsed!, newHash)).toBe(false);
  });

  it("rejects sessions created before password stamps existed", () => {
    const hash = hashPassword("old-password-123");
    const legacyPayload = { userId: "user_123", email: "dj@example.com" };

    expect(isSessionCurrent(legacyPayload as never, hash)).toBe(false);
  });

  it("refuses the public fallback secret in production", async () => {
    const { env } = await import("@/lib/env");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    try {
      expect(() => env.authSecret).toThrow("AUTH_SECRET is required");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
