import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  validate: vi.fn(),
  drain: vi.fn(),
  findSessions: vi.fn(),
  claimSession: vi.fn(),
  reconcile: vi.fn()
}));

vi.mock("@/lib/twitch-security", async (original) => ({
  ...(await original<typeof import("@/lib/twitch-security")>()),
  isTwitchConfigured: mocks.configured
}));
vi.mock("@/lib/twitch", () => ({
  validateTwitchConnections: mocks.validate,
  drainPendingTwitchEvents: mocks.drain
}));
vi.mock("@/lib/db", () => ({
  db: { dJSession: { findMany: mocks.findSessions, updateMany: mocks.claimSession } }
}));
vi.mock("@/lib/submission-pipeline", () => ({
  reconcilePendingRenderJobs: mocks.reconcile
}));

import { GET } from "@/app/api/twitch/process/route";

function request(authorization = "Bearer cron-secret") {
  return new Request("https://story.example/api/twitch/process", {
    headers: { authorization }
  });
}

const session = { id: "story-1", updatedAt: new Date("2026-09-16T12:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-secret");
  mocks.configured.mockReturnValue(false);
  mocks.validate.mockResolvedValue({ validated: 1 });
  mocks.drain.mockResolvedValue({ processed: 2 });
  mocks.findSessions.mockResolvedValue([session]);
  mocks.claimSession.mockResolvedValue({ count: 1 });
  mocks.reconcile.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("scheduled story maintenance", () => {
  it("rejects missing configuration or invalid authorization before doing work", async () => {
    expect((await GET(request("Bearer wrong-secret"))).status).toBe(401);
    expect((await GET(request(""))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(401);
    expect(mocks.configured).not.toHaveBeenCalled();
    expect(mocks.findSessions).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("continues active stories without Twitch configuration or an open dashboard", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      processed: 0,
      stories: { checked: 1, reconciled: 1, failed: 0 }
    });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.findSessions).toHaveBeenCalledWith({
      where: {
        status: "live",
        autoSelectEnabled: true,
        playbackState: { is: { emergencyPaused: false } }
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: { id: true, updatedAt: true },
      take: 10
    });
    expect(mocks.reconcile).toHaveBeenCalledWith("story-1");
  });

  it("saves pending Twitch input before running story continuation", async () => {
    const operations: string[] = [];
    mocks.configured.mockReturnValue(true);
    mocks.validate.mockImplementation(async () => {
      operations.push("validate");
      return { validated: 1 };
    });
    mocks.drain.mockImplementation(async () => {
      operations.push("drain");
      return { processed: 2 };
    });
    mocks.reconcile.mockImplementation(async () => operations.push("reconcile"));

    const response = await GET(request());

    expect(operations).toEqual(["validate", "drain", "reconcile"]);
    expect(mocks.drain).toHaveBeenCalledWith({ limit: 10 });
    expect(await response.json()).toEqual({
      configured: true,
      processed: 2,
      validation: { validated: 1 },
      stories: { checked: 1, reconciled: 1, failed: 0 }
    });
  });

  it("keeps story maintenance running when Twitch validation and intake fail", async () => {
    mocks.configured.mockReturnValue(true);
    mocks.validate.mockRejectedValue(new Error("token=private-secret"));
    mocks.drain.mockRejectedValue(new Error("chat-private-text"));

    const response = await GET(request());
    const payload = await response.json();

    expect(payload).toEqual({
      configured: true,
      processed: 0,
      twitchErrors: expect.arrayContaining(["validation", "intake"]),
      stories: { checked: 1, reconciled: 1, failed: 0 }
    });
    expect(mocks.drain).toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith("story-1");
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  it("reconciles after intake finishes even while token validation is still pending", async () => {
    let finishValidation!: (value: { validated: number }) => void;
    let finishIntake!: (value: { processed: number }) => void;
    mocks.configured.mockReturnValue(true);
    mocks.validate.mockReturnValue(new Promise((resolve) => { finishValidation = resolve; }));
    mocks.drain.mockReturnValue(new Promise((resolve) => { finishIntake = resolve; }));
    let responseFinished = false;
    const responsePromise = GET(request()).then((response) => {
      responseFinished = true;
      return response;
    });

    expect(mocks.validate).toHaveBeenCalled();
    expect(mocks.drain).toHaveBeenCalled();
    expect(mocks.findSessions).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();

    finishIntake({ processed: 2 });
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith("story-1"));
    expect(responseFinished).toBe(false);

    finishValidation({ validated: 1 });
    const response = await responsePromise;
    expect(await response.json()).toMatchObject({
      processed: 2,
      validation: { validated: 1 },
      stories: { checked: 1, reconciled: 1, failed: 0 }
    });
  });

  it("rotates failed sessions through the batch without blocking healthy sessions", async () => {
    mocks.findSessions.mockResolvedValue([session, { ...session, id: "story-2" }]);
    mocks.reconcile.mockImplementation(async (sessionId: string) => {
      if (sessionId === "story-1") throw new Error("provider unavailable");
      return [];
    });

    const response = await GET(request());

    expect(mocks.claimSession).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenCalledWith("story-2");
    expect(await response.json()).toMatchObject({
      stories: { checked: 2, reconciled: 1, failed: 1 }
    });
    const firstClaim = mocks.claimSession.mock.calls[0][0];
    expect(firstClaim.where).toMatchObject({ id: "story-1", updatedAt: session.updatedAt });
    expect(firstClaim.data.updatedAt.getTime()).toBeGreaterThan(session.updatedAt.getTime());
  });

  it("does not reconcile a session changed, paused, or claimed by another worker", async () => {
    mocks.claimSession.mockResolvedValue({ count: 0 });

    const response = await GET(request());

    expect(mocks.claimSession).toHaveBeenCalledWith({
      where: {
        id: "story-1",
        updatedAt: session.updatedAt,
        status: "live",
        autoSelectEnabled: true,
        playbackState: { is: { emergencyPaused: false } }
      },
      data: { updatedAt: expect.any(Date) }
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      stories: { checked: 1, reconciled: 0, failed: 0 }
    });
  });
});
