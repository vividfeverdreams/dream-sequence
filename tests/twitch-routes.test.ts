import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), status: vi.fn(),
  updateConnection: vi.fn(), accept: vi.fn(), drain: vi.fn(), after: vi.fn()
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/twitch", () => ({
  connectTwitchAccount: mocks.connect, disconnectTwitchAccount: mocks.disconnect,
  getTwitchConnectionStatus: mocks.status, twitchAuthorizationUrl: (state: string) => `https://id.twitch.tv/oauth2/authorize?state=${state}`
}));
vi.mock("@/lib/db", () => ({ db: { twitchConnection: { updateMany: mocks.updateConnection } } }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/twitch-events", async (original) => ({
  ...(await original<typeof import("@/lib/twitch-events")>()), acceptTwitchChatEvent: mocks.accept, drainPendingTwitchEvents: mocks.drain
}));
vi.mock("@/lib/submission-pipeline", () => ({ ingestSubmission: vi.fn() }));

import { createTwitchOAuthState, twitchStateCookie } from "@/lib/twitch-security";
import { GET as connect } from "@/app/api/twitch/connect/route";
import { GET as callback } from "@/app/api/twitch/callback/route";
import { POST as disconnect } from "@/app/api/twitch/disconnect/route";
import { GET as status } from "@/app/api/twitch/status/route";
import { POST as webhook } from "@/app/api/twitch/webhook/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://story.example");
  vi.stubEnv("TWITCH_CLIENT_ID", "client");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "client-secret");
  vi.stubEnv("TWITCH_EVENTSUB_SECRET", "a".repeat(64));
  vi.stubEnv("TWITCH_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("TWITCH_REDIRECT_URI", "");
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.connect.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue({ connected: false, revokeAtTwitch: false });
  mocks.accept.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("Twitch account routes", () => {
  it("starts OAuth only for an authenticated owner and sets an HttpOnly state cookie", async () => {
    const response = await connect(new NextRequest("https://story.example/api/twitch/connect?returnTo=/dashboard/new"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("https://id.twitch.tv/oauth2/authorize");
    expect(response.cookies.get(twitchStateCookie)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    mocks.user.mockResolvedValueOnce(null);
    const unauthenticated = await connect(new NextRequest("https://story.example/api/twitch/connect"));
    expect(unauthenticated.headers.get("location")).toBe("https://story.example/login");
  });

  it("does not start OAuth when Twitch deployment configuration is absent", async () => {
    vi.stubEnv("TWITCH_CLIENT_SECRET", "");
    const response = await connect(new NextRequest("https://story.example/api/twitch/connect"));
    expect(new URL(response.headers.get("location")!).searchParams.get("twitch")).toBe("error");
    expect(response.cookies.get(twitchStateCookie)).toBeUndefined();
  });

  it("exchanges a code only when signed state matches the same browser and owner", async () => {
    const state = createTwitchOAuthState("owner", "/dashboard/new");
    const url = new URL("https://story.example/api/twitch/callback");
    url.searchParams.set("state", state);
    url.searchParams.set("code", "oauth-code");
    const response = await callback(new NextRequest(url, { headers: { cookie: `${twitchStateCookie}=${state}` } }));
    expect(mocks.connect).toHaveBeenCalledWith("owner", "oauth-code");
    expect(response.headers.get("location")).toBe("https://story.example/dashboard/new?twitch=connected");
    expect(response.cookies.get(twitchStateCookie)?.maxAge).toBe(0);
    mocks.connect.mockClear();
    mocks.user.mockResolvedValueOnce({ id: "other-owner" });
    const rejected = await callback(new NextRequest(url, { headers: { cookie: `${twitchStateCookie}=${state}` } }));
    expect(new URL(rejected.headers.get("location")!).searchParams.get("twitch")).toBe("error");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("never reflects OAuth provider errors or sensitive failure details into redirects", async () => {
    const state = createTwitchOAuthState("owner", "/dashboard/new");
    mocks.connect.mockRejectedValueOnce(new Error("provider token=private-secret"));
    const url = new URL("https://story.example/api/twitch/callback");
    url.searchParams.set("state", state);
    url.searchParams.set("code", "oauth-code");
    const response = await callback(new NextRequest(url, { headers: { cookie: `${twitchStateCookie}=${state}` } }));
    expect(response.headers.get("location")).not.toContain("private-secret");
  });

  it("requires authentication and a same-origin request to disconnect", async () => {
    const crossSite = await disconnect(new Request("https://story.example/api/twitch/disconnect", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(crossSite.status).toBe(403);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    const response = await disconnect(new Request("https://story.example/api/twitch/disconnect", { method: "POST", headers: { origin: "https://story.example" } }));
    expect(response.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith("owner");
    mocks.user.mockResolvedValueOnce(null);
    expect((await status()).status).toBe(401);
  });
});

describe("Twitch webhook route", () => {
  const subscription = { id: "sub-1", type: "channel.chat.message", version: "1", status: "enabled", condition: { broadcaster_user_id: "channel-1", user_id: "channel-1" } };
  function signedRequest(payload: unknown, type: string) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const id = "delivery-1";
    const signature = createHmac("sha256", "a".repeat(64)).update(id + timestamp + body).digest("hex");
    return new Request("https://story.example/api/twitch/webhook", { method: "POST", body, headers: {
      "twitch-eventsub-message-id": id, "twitch-eventsub-message-timestamp": timestamp,
      "twitch-eventsub-message-signature": `sha256=${signature}`, "twitch-eventsub-message-type": type
    } });
  }

  it("returns the exact signed verification challenge and never sends it to story intake", async () => {
    const response = await webhook(signedRequest({ subscription, challenge: "challenge-value" }, "webhook_callback_verification"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-value");
    expect(mocks.updateConnection).toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects unsigned or malformed JSON before persistence", async () => {
    expect((await webhook(new Request("https://story.example/api/twitch/webhook", { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await webhook(signedRequest("{", "notification"))).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("persists signed events before acknowledging and schedules processing after the response", async () => {
    const response = await webhook(signedRequest({ subscription }, "notification"));
    expect(response.status).toBe(204);
    expect(mocks.accept).toHaveBeenCalledWith("delivery-1", { subscription }, expect.any(Date));
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.drain).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.drain).toHaveBeenCalledWith({ limit: 5 });
  });

  it("clears credentials on a signed authorization revocation", async () => {
    expect((await webhook(signedRequest({ subscription: { ...subscription, status: "authorization_revoked" } }, "revocation"))).status).toBe(204);
    expect(mocks.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ data: {
      subscriptionStatus: "authorization_revoked", encryptedAccessToken: "", encryptedRefreshToken: ""
    } }));
  });
});
