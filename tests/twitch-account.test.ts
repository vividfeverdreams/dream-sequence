import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), remove: vi.fn(), discard: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  twitchConnection: { findUnique: mocks.find, upsert: mocks.upsert, update: mocks.update, updateMany: mocks.updateMany, delete: mocks.remove },
  twitchEventDelivery: { updateMany: mocks.discard }
} }));
vi.mock("@/lib/twitch-events", () => ({ drainPendingTwitchEvents: vi.fn() }));

import { connectTwitchAccount, disconnectTwitchAccount, getValidTwitchConnection } from "@/lib/twitch";
import { decryptTwitchToken, encryptTwitchToken, twitchScopes } from "@/lib/twitch-security";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://story.example");
  vi.stubEnv("TWITCH_CLIENT_ID", "client");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "client-secret");
  vi.stubEnv("TWITCH_EVENTSUB_SECRET", "a".repeat(64));
  vi.stubEnv("TWITCH_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("TWITCH_REDIRECT_URI", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function savedConnection() {
  return {
    id: "connection-1", userId: "owner", twitchUserId: "channel-1", login: "streamer",
    encryptedAccessToken: encryptTwitchToken("old-access", "owner"), encryptedRefreshToken: encryptTwitchToken("old-refresh", "owner"),
    tokenValidatedAt: new Date(0), tokenExpiresAt: new Date(0), updatedAt: new Date(0),
    subscriptionStatus: "enabled", subscriptionId: "sub-1"
  };
}

describe("Twitch account lifecycle", () => {
  it("stores encrypted tokens and subscribes with an app token using the owner's channel identity", async () => {
    mocks.find.mockResolvedValue(null);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ client_id: "client", user_id: "channel-1", scopes: twitchScopes, expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "channel-1", login: "streamer", display_name: "Streamer" }] }))
      .mockResolvedValueOnce(Response.json({ access_token: "app-access", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "sub-1", status: "webhook_callback_verification_pending" }] }));
    vi.stubGlobal("fetch", fetch);
    await connectTwitchAccount("owner", "code-123");
    const stored = mocks.upsert.mock.calls[0][0].create;
    expect(stored.encryptedAccessToken).not.toContain("new-access");
    expect(decryptTwitchToken(stored.encryptedAccessToken, "owner")).toBe("new-access");
    expect(decryptTwitchToken(stored.encryptedRefreshToken, "owner")).toBe("new-refresh");
    const subscribe = fetch.mock.calls[4][1];
    expect(subscribe.headers.Authorization).toBe("Bearer app-access");
    expect(JSON.parse(subscribe.body)).toMatchObject({ type: "channel.chat.message", condition: { broadcaster_user_id: "channel-1", user_id: "channel-1" }, transport: { method: "webhook", callback: "https://story.example/api/twitch/webhook" } });
  });

  it("rejects grants for another client or grants missing required chat permissions", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ client_id: "different-client", user_id: "channel-1", scopes: twitchScopes, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    await expect(connectTwitchAccount("owner", "code-123")).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("refreshes expired grants and stores the newly rotated refresh token", async () => {
    mocks.find.mockResolvedValue(savedConnection());
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: "invalid token" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ client_id: "client", user_id: "channel-1", scopes: twitchScopes, expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    await getValidTwitchConnection("owner");
    const stored = mocks.updateMany.mock.calls[0][0].data;
    expect(decryptTwitchToken(stored.encryptedRefreshToken, "owner")).toBe("new-refresh");
    expect(stored.tokenValidatedAt).toBeInstanceOf(Date);
  });

  it("disconnects locally even when Twitch's remote cleanup is unavailable", async () => {
    mocks.find.mockResolvedValue(savedConnection());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Twitch unavailable")));
    expect(await disconnectTwitchAccount("owner")).toEqual({ connected: false, revokeAtTwitch: true });
    expect(mocks.remove).toHaveBeenCalledWith({ where: { userId: "owner" } });
    expect(mocks.discard).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "discarded", payload: "{}" }) }));
  });
});
