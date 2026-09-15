import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTwitchOAuthState, decryptTwitchToken, encryptTwitchToken, isTwitchConfigured,
  parseTwitchContinuation, safeTwitchReturnPath, validateTwitchOAuthState, verifyTwitchWebhook
} from "@/lib/twitch-security";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://story.example");
  vi.stubEnv("TWITCH_CLIENT_ID", "client");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "client-secret");
  vi.stubEnv("TWITCH_EVENTSUB_SECRET", "a".repeat(64));
  vi.stubEnv("TWITCH_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("TWITCH_REDIRECT_URI", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Twitch authorization security", () => {
  it("requires a public HTTPS callback and full server credentials", () => {
    expect(isTwitchConfigured()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(isTwitchConfigured()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://story.example");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "");
    expect(isTwitchConfigured()).toBe(false);
  });

  it("encrypts tokens with a random nonce and binds them to their owner", () => {
    const encrypted = encryptTwitchToken("test-access-token", "owner");
    expect(encrypted).not.toContain("test-access-token");
    expect(encryptTwitchToken("test-access-token", "owner")).not.toBe(encrypted);
    expect(decryptTwitchToken(encrypted, "owner")).toBe("test-access-token");
    expect(() => decryptTwitchToken(encrypted, "other-owner")).toThrow();
    const pieces = encrypted.split(".");
    pieces[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptTwitchToken(pieces.join("."), "owner")).toThrow();
  });

  it("requires the signed state, browser cookie, same user, and valid expiration", () => {
    const now = Date.now();
    const state = createTwitchOAuthState("owner", "/dashboard/new", now);
    expect(validateTwitchOAuthState(state, state, "owner", now)).toEqual({ returnTo: "/dashboard/new" });
    expect(validateTwitchOAuthState(state, undefined, "owner", now)).toBeNull();
    expect(validateTwitchOAuthState(state, state, "another-user", now)).toBeNull();
    expect(validateTwitchOAuthState(state, state, "owner", now + 600_001)).toBeNull();
    const tampered = state.slice(0, -1) + (state.endsWith("x") ? "y" : "x");
    expect(validateTwitchOAuthState(tampered, tampered, "owner", now)).toBeNull();
  });

  it("cannot redirect to an external destination", () => {
    for (const path of ["https://evil.example", "//evil.example", "/\\evil.example", "/dashboard/new?next=//evil.example"]) {
      expect(safeTwitchReturnPath(path)).toBe("/dashboard/new");
    }
  });
});

describe("Twitch EventSub verification", () => {
  const secret = "a".repeat(64);
  function headers(body: string, timestamp = new Date().toISOString()) {
    const id = "notification-123";
    const signature = createHmac("sha256", secret).update(id + timestamp + body).digest("hex");
    return new Headers({
      "twitch-eventsub-message-id": id, "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-signature": `sha256=${signature}`
    });
  }

  it("authenticates the exact raw bytes, message ID, and timestamp", () => {
    const body = '{ "challenge": "hello" }';
    const signedHeaders = headers(body);
    expect(verifyTwitchWebhook({ body, headers: signedHeaders, secret })).toBe(true);
    expect(verifyTwitchWebhook({ body: JSON.stringify(JSON.parse(body)), headers: signedHeaders, secret })).toBe(false);
    signedHeaders.set("twitch-eventsub-message-id", "changed-id");
    expect(verifyTwitchWebhook({ body, headers: signedHeaders, secret })).toBe(false);
  });

  it("rejects stale, future, missing, and malformed signatures", () => {
    const now = Date.now();
    const body = "{}";
    expect(verifyTwitchWebhook({ body, headers: headers(body, new Date(now - 601_000).toISOString()), secret, now })).toBe(false);
    expect(verifyTwitchWebhook({ body, headers: headers(body, new Date(now + 120_000).toISOString()), secret, now })).toBe(false);
    expect(verifyTwitchWebhook({ body, headers: new Headers(), secret, now })).toBe(false);
    const malformed = headers(body);
    malformed.set("twitch-eventsub-message-signature", "sha256=bad");
    expect(verifyTwitchWebhook({ body, headers: malformed, secret, now })).toBe(false);
  });

  it("accepts only explicit nonempty !next commands", () => {
    expect(parseTwitchContinuation("  !NeXt The moon opens like a door.  ")).toBe("The moon opens like a door.");
    for (const text of ["hello chat", "!next", "!next   ", "!nextdoor surprise", "!next " + "x".repeat(1_001), null]) {
      expect(parseTwitchContinuation(text)).toBeNull();
    }
  });
});
