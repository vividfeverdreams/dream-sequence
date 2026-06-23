import { describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, parseSessionToken, verifyPassword } from "@/lib/auth-core";

describe("auth helpers", () => {
  it("hashes and verifies passwords", () => {
    const password = "dreamsequence-demo";
    const hash = hashPassword(password);

    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("creates verifiable session tokens", () => {
    const token = createSessionToken({
      userId: "user_123",
      email: "dj@example.com"
    });

    const parsed = parseSessionToken(token);

    expect(parsed?.userId).toBe("user_123");
    expect(parsed?.email).toBe("dj@example.com");
  });
});
