import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  getCurrentUser: vi.fn(),
  parseRelayToken: vi.fn(),
  reconcilePendingRenderJobs: vi.fn(),
  after: vi.fn(),
  drainPendingTwitchEvents: vi.fn()
}));

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/twitch", () => ({ drainPendingTwitchEvents: mocks.drainPendingTwitchEvents }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser
}));

vi.mock("@/lib/audio-sync-relay-token", () => ({
  parseAudioSyncRelayToken: mocks.parseRelayToken
}));

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findFirst: mocks.findSession
    }
  }
}));

vi.mock("@/lib/submission-pipeline", () => ({
  reconcilePendingRenderJobs: mocks.reconcilePendingRenderJobs
}));

import { POST } from "@/app/api/sessions/[sessionId]/reconcile/route";

describe("render reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.findSession.mockResolvedValue({
      id: "session-1"
    });
    mocks.reconcilePendingRenderJobs.mockResolvedValue([
      {
        id: "render-1",
        progress: 42,
        status: "in_progress"
      }
    ]);
  });

  it("reconciles renders before processing the Twitch inbox in the background", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "owner" });
    mocks.findSession.mockResolvedValue({ id: "session-1", audienceMode: "twitch" });
    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", { method: "POST" }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    expect(response.status).toBe(200);
    expect(mocks.reconcilePendingRenderJobs).toHaveBeenCalledWith("session-1");
    expect(mocks.drainPendingTwitchEvents).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.drainPendingTwitchEvents).toHaveBeenCalledWith({ userId: "owner", limit: 5 });
  });

  it("accepts the signed live-session relay token when the login cookie is stale", async () => {
    mocks.parseRelayToken.mockReturnValue({
      sessionId: "session-1",
      userId: "user-1",
      exp: Date.now() + 60_000
    });

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer signed-relay-token"
        }
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(200);
    expect(mocks.parseRelayToken).toHaveBeenCalledWith("signed-relay-token");
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-1"
      }
    });
    expect(mocks.reconcilePendingRenderJobs).toHaveBeenCalledWith("session-1");
  });

  it("rejects a relay token issued for another live session", async () => {
    mocks.parseRelayToken.mockReturnValue({
      sessionId: "session-other",
      userId: "user-1",
      exp: Date.now() + 60_000
    });

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-session-token"
        }
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(401);
    expect(mocks.findSession).not.toHaveBeenCalled();
    expect(mocks.reconcilePendingRenderJobs).not.toHaveBeenCalled();
  });

  it("rejects an invalid relay token when the login cookie is absent", async () => {
    mocks.parseRelayToken.mockReturnValue(null);

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-relay-token"
        }
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(401);
    expect(mocks.findSession).not.toHaveBeenCalled();
    expect(mocks.reconcilePendingRenderJobs).not.toHaveBeenCalled();
  });

  it("continues to accept the authenticated DJ session", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-cookie"
    });

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", {
        method: "POST"
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(200);
    expect(mocks.parseRelayToken).not.toHaveBeenCalled();
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-cookie"
      }
    });
  });

  it("prefers a valid relay token over an unrelated stale login cookie", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "unrelated-cookie-user"
    });
    mocks.parseRelayToken.mockReturnValue({
      sessionId: "session-1",
      userId: "relay-user",
      exp: Date.now() + 60_000
    });

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer signed-relay-token"
        }
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(200);
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "relay-user"
      }
    });
  });
});
