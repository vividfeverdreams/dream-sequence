import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = {
    findSession: vi.fn(),
    findStillIdleSession: vi.fn(),
    claimSession: vi.fn(),
    findPendingInput: vi.fn(),
    createSubmission: vi.fn(),
    updateSubmissions: vi.fn(),
    countSubmissions: vi.fn(),
    findRecentClips: vi.fn(),
    createModeration: vi.fn(),
    createRanking: vi.fn(),
    findTwitchConnection: vi.fn(),
    findTwitchDelivery: vi.fn(),
    generatePrompt: vi.fn(),
    assessSubmission: vi.fn()
  };
  const tx = {
    dJSession: {
      findUnique: values.findSession,
      findFirst: values.findStillIdleSession,
      updateMany: values.claimSession
    },
    promptSubmission: {
      findFirst: values.findPendingInput,
      create: values.createSubmission,
      updateMany: values.updateSubmissions
    },
    moderationResult: { create: values.createModeration },
    rankingResult: { create: values.createRanking },
    twitchConnection: { findUnique: values.findTwitchConnection },
    twitchEventDelivery: { findFirst: values.findTwitchDelivery }
  };
  return {
    ...values,
    runTransaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.runTransaction,
    renderJob: { findMany: mocks.findRecentClips },
    promptSubmission: {
      count: mocks.countSubmissions,
      updateMany: mocks.updateSubmissions
    }
  }
}));

vi.mock("@/lib/story-continuation-prompt", () => ({
  generateStoryContinuationPrompt: mocks.generatePrompt
}));

vi.mock("@/lib/ai-assessment", () => ({
  assessSubmission: mocks.assessSubmission
}));

import {
  automaticSubmissionSource,
  createIdleStoryContinuation,
  storyContinuationIntervalMs,
  storyInputReceivedEvent
} from "@/lib/story-continuation";

const nowMs = Date.parse("2026-09-16T12:01:00.000Z");
const generatedPrompt = "The fox discovers that the pearl shell unfolds into a glowing boat.";
const renderPrompt = "Continue from the source frame: the fox boards a glowing boat, in teal and ember.";

function sessionFixture() {
  return {
    id: "session-1",
    userId: "user-1",
    status: "live",
    audienceMode: "web",
    autoSelectEnabled: true,
    startedAt: new Date(nowMs - 60_000),
    updatedAt: new Date(nowMs - 120_000),
    basePrompt: "A fox opens a door in the forest.",
    artistName: "Dream Artist",
    trackName: "Dream Track",
    creativeBible: "A continuous dream story.",
    allowedMotifs: "",
    bannedTerms: "",
    colorPalette: "teal, ember",
    motionRules: "",
    artistControlEnabled: true,
    venueSafeMode: true,
    playbackState: {
      emergencyPaused: false,
      currentAsset: {
        id: "asset-current",
        publicUrl: "https://example.com/current.mp4",
        promptText: "The fox has reached an underwater city.",
        createdAt: new Date(nowMs - 50_000),
        updatedAt: new Date(nowMs - 45_000)
      }
    },
    submissions: [] as Array<{ id: string; source: string; status: string; createdAt: Date }>,
    auditEvents: [] as Array<{ type: string; createdAt: Date }>,
    renderJobs: [] as Array<{ id: string; status: string }>,
    visualAssets: [] as Array<{ id: string; status: string; publicUrl: string }>
  };
}

function assessmentFixture() {
  return {
    decision: "approved",
    score: 90,
    flags: [],
    explanation: "Safe next story event.",
    approvalReason: "Advances the current scene.",
    noveltyScore: 91,
    cohesionScore: 89,
    remixDeltaScore: 90,
    winningPrompt: renderPrompt
  };
}

describe("idle story continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    mocks.findSession.mockResolvedValue(sessionFixture());
    mocks.findStillIdleSession.mockResolvedValue({ id: "session-1" });
    mocks.claimSession.mockResolvedValue({ count: 1 });
    mocks.findPendingInput.mockResolvedValue(null);
    mocks.updateSubmissions.mockResolvedValue({ count: 1 });
    mocks.createSubmission.mockImplementation(async ({ data }) => ({ id: "automatic-1", ...data }));
    mocks.findRecentClips.mockResolvedValue([]);
    mocks.countSubmissions.mockResolvedValue(1);
    mocks.createModeration.mockResolvedValue({ id: "moderation-1" });
    mocks.createRanking.mockResolvedValue({ id: "ranking-1" });
    mocks.findTwitchConnection.mockResolvedValue({ twitchUserId: "channel-1" });
    mocks.findTwitchDelivery.mockResolvedValue(null);
    mocks.generatePrompt.mockResolvedValue(generatedPrompt);
    mocks.assessSubmission.mockResolvedValue(assessmentFixture());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits until exactly one minute after the session starts", async () => {
    expect(storyContinuationIntervalMs).toBe(60_000);
    vi.setSystemTime(nowMs - 1);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();

    vi.setSystemTime(nowMs);
    expect(await createIdleStoryContinuation("session-1")).toEqual({ id: "automatic-1", prompt: renderPrompt });
    expect(mocks.generatePrompt).toHaveBeenCalledTimes(1);
  });

  it.each(["web", "sms", "twitch"])("resets the minute for a later %s audience input", async (source) => {
    const session = sessionFixture();
    const inputAt = new Date(nowMs - 30_000);
    session.submissions = [{ id: "audience-1", source, status: "rendered", createdAt: inputAt }];
    mocks.findSession.mockResolvedValue(session);
    vi.setSystemTime(inputAt.getTime() + 59_999);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();

    vi.setSystemTime(inputAt.getTime() + 60_000);
    expect(await createIdleStoryContinuation("session-1")).toEqual({ id: "automatic-1", prompt: renderPrompt });
    expect(mocks.createSubmission).toHaveBeenCalledWith({
      data: expect.objectContaining({ messageSid: `automatic:session-1:${inputAt.getTime()}` })
    });
  });

  it("uses the persisted automatic draft to begin each subsequent one-minute interval", async () => {
    const session = sessionFixture();
    mocks.findSession.mockResolvedValue(session);

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    const firstDraft = mocks.createSubmission.mock.calls[0][0].data;
    session.submissions = [{
      id: "automatic-1", source: firstDraft.source, status: "rendered", createdAt: firstDraft.createdAt
    }];

    vi.setSystemTime(nowMs + 59_999);
    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).toHaveBeenCalledTimes(1);

    vi.setSystemTime(nowMs + 60_000);
    mocks.countSubmissions.mockResolvedValue(2);
    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.generatePrompt).toHaveBeenCalledTimes(2);
    expect(mocks.generatePrompt.mock.calls[1][0].continuationNumber).toBe(2);
    expect(mocks.createSubmission.mock.calls[1][0].data).toMatchObject({
      createdAt: new Date(nowMs + 60_000),
      messageSid: `automatic:session-1:${nowMs}`
    });
  });

  it("uses a restarted session's new start time instead of old audience input", async () => {
    const session = sessionFixture();
    session.startedAt = new Date(nowMs - 10_000);
    session.submissions = [{
      id: "old-input", source: "web", status: "rendered", createdAt: new Date(nowMs - 600_000)
    }];
    mocks.findSession.mockResolvedValue(session);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
  });

  it("resets the minute as soon as web input is received, before its submission is persisted", async () => {
    const session = sessionFixture();
    const inputReceivedAt = new Date(nowMs - 10_000);
    session.auditEvents = [{ type: storyInputReceivedEvent, createdAt: inputReceivedAt }];
    mocks.findSession.mockResolvedValue(session);
    vi.setSystemTime(inputReceivedAt.getTime() + 59_999);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();

    vi.setSystemTime(inputReceivedAt.getTime() + 60_000);
    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.createSubmission).toHaveBeenCalledWith({
      data: expect.objectContaining({ messageSid: `automatic:session-1:${inputReceivedAt.getTime()}` })
    });
  });

  it.each([
    { name: "a missing session", session: () => null },
    { name: "a draft session", session: () => ({ ...sessionFixture(), status: "draft" }) },
    { name: "a stopped session", session: () => ({ ...sessionFixture(), status: "stopped" }) },
    { name: "automatic selection disabled", session: () => ({ ...sessionFixture(), autoSelectEnabled: false }) },
    { name: "a missing start time", session: () => ({ ...sessionFixture(), startedAt: null }) },
    { name: "missing playback", session: () => ({ ...sessionFixture(), playbackState: null }) },
    {
      name: "paused playback",
      session: () => ({ ...sessionFixture(), playbackState: { ...sessionFixture().playbackState, emergencyPaused: true } })
    },
    {
      name: "no opening clip yet",
      session: () => ({ ...sessionFixture(), playbackState: { emergencyPaused: false, currentAsset: null } })
    },
    {
      name: "an unplayable current clip",
      session: () => ({
        ...sessionFixture(),
        playbackState: { emergencyPaused: false, currentAsset: { ...sessionFixture().playbackState.currentAsset, publicUrl: null } }
      })
    },
    { name: "a queued render", session: () => ({ ...sessionFixture(), renderJobs: [{ id: "render-1", status: "queued" }] }) },
    {
      name: "an in-progress render",
      session: () => ({ ...sessionFixture(), renderJobs: [{ id: "render-1", status: "in_progress" }] })
    },
    {
      name: "a clip waiting to play",
      session: () => ({ ...sessionFixture(), visualAssets: [{ id: "asset-next", status: "ready", publicUrl: "https://example.com/next.mp4" }] })
    }
  ])("does not generate for $name", async ({ session }) => {
    mocks.findSession.mockResolvedValue(session());

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();
  });

  it.each(["submitted", "approved"])("gives an existing %s audience idea priority", async (status) => {
    mocks.findPendingInput.mockResolvedValue({ id: "audience-pending", status });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.findPendingInput).toHaveBeenCalledWith({
      where: { sessionId: "session-1", status: { in: expect.arrayContaining([status]) } },
      select: { id: true }
    });
    expect(mocks.claimSession).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();
  });

  it("does not generate after losing the shared session claim", async () => {
    mocks.claimSession.mockResolvedValue({ count: 0 });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();
  });

  it("permits only one of two workers to create the next draft", async () => {
    mocks.claimSession.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const results = await Promise.all([
      createIdleStoryContinuation("session-1"),
      createIdleStoryContinuation("session-1")
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mocks.claimSession).toHaveBeenCalledTimes(2);
    expect(mocks.createSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.generatePrompt).toHaveBeenCalledTimes(1);
    expect(mocks.claimSession).toHaveBeenCalledWith({
      where: { id: "session-1", updatedAt: sessionFixture().updatedAt },
      data: { updatedAt: new Date(nowMs) }
    });
  });

  it("changes the session claim even when its old update timestamp equals the clock", async () => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), updatedAt: new Date(nowMs) });

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.claimSession).toHaveBeenCalledWith({
      where: { id: "session-1", updatedAt: new Date(nowMs) },
      data: { updatedAt: new Date(nowMs + 1) }
    });
  });

  it.each(["new input", "pause", "stop", "session restart"])("discards a generated draft when %s invalidates the final eligibility check", async () => {
    mocks.findStillIdleSession.mockResolvedValue(null);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).toHaveBeenCalledOnce();
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: expect.objectContaining({
        rawText: generatedPrompt,
        status: "rejected",
        approvalReason: expect.stringContaining("new input arrived or the session was paused")
      })
    });
    expect(mocks.findStillIdleSession).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "session-1",
        status: "live",
        autoSelectEnabled: true,
        startedAt: sessionFixture().startedAt,
        playbackState: { is: { emergencyPaused: false } },
        auditEvents: {
          none: { type: storyInputReceivedEvent, createdAt: { gt: sessionFixture().startedAt } }
        },
        submissions: {
          none: {
            source: { not: automaticSubmissionSource },
            OR: [
              { createdAt: { gt: sessionFixture().startedAt } },
              { status: { in: ["submitted", "approved"] } }
            ]
          }
        }
      }),
      select: { id: true }
    });
  });

  it("cancels a prepared continuation when web input was received but has not reached submission persistence", async () => {
    const inputReceivedAt = new Date(nowMs + 1);
    mocks.findStillIdleSession.mockImplementation(async ({ where }) => {
      const receiptFilter = where.auditEvents.none;
      return receiptFilter.type === storyInputReceivedEvent && inputReceivedAt > receiptFilter.createdAt.gt
        ? null
        : { id: "session-1" };
    });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: expect.objectContaining({ status: "rejected" })
    });
  });

  it("does not revive a draft already completed or recovered by another worker", async () => {
    mocks.updateSubmissions.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).toHaveBeenCalledOnce();
    expect(mocks.createModeration).not.toHaveBeenCalled();
    expect(mocks.createRanking).not.toHaveBeenCalled();
  });

  it("marks a stale interrupted draft failed before allowing a retry", async () => {
    const session = sessionFixture();
    session.startedAt = new Date(nowMs - 600_000);
    session.submissions = [{
      id: "automatic-stale", source: automaticSubmissionSource,
      status: "submitted", createdAt: new Date(nowMs - 60_000)
    }];
    mocks.findSession.mockResolvedValue(session);
    let stalePending = true;
    mocks.updateSubmissions.mockImplementation(async ({ where }) => {
      if (where.source === automaticSubmissionSource) stalePending = false;
      return { count: 1 };
    });
    mocks.findPendingInput.mockImplementation(async () => stalePending ? { id: "automatic-stale" } : null);

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.updateSubmissions).toHaveBeenNthCalledWith(1, {
      where: {
        sessionId: "session-1", source: automaticSubmissionSource,
        status: "submitted", createdAt: { lte: new Date(nowMs - 60_000) }
      },
      data: {
        status: "failed",
        approvalReason: expect.stringContaining("interrupted")
      }
    });
    expect(mocks.updateSubmissions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findPendingInput.mock.invocationCallOrder[0]
    );
  });

  it("does not reclaim an interrupted draft before its minute has elapsed", async () => {
    const session = sessionFixture();
    session.startedAt = new Date(nowMs - 600_000);
    session.submissions = [{
      id: "automatic-still-working", source: automaticSubmissionSource,
      status: "submitted", createdAt: new Date(nowMs - 59_999)
    }];
    mocks.findSession.mockResolvedValue(session);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.updateSubmissions).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();
  });

  it("persists moderation rejection without making a render candidate", async () => {
    mocks.assessSubmission.mockResolvedValue({
      ...assessmentFixture(), decision: "rejected", score: 0,
      flags: ["blocked-term"], approvalReason: "Rejected by venue-safe checks."
    });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: expect.objectContaining({ status: "rejected", approvalReason: "Rejected by venue-safe checks." })
    });
    expect(mocks.createModeration).toHaveBeenCalledWith({
      data: expect.objectContaining({ submissionId: "automatic-1", decision: "rejected", flags: '["blocked-term"]' })
    });
  });

  it.each(["context", "generation", "assessment", "persistence"])("marks the draft failed when %s fails after claiming", async (stage) => {
    const error = new Error("Private provider or storage details");
    if (stage === "context") mocks.findRecentClips.mockRejectedValue(error);
    if (stage === "generation") mocks.generatePrompt.mockRejectedValue(error);
    if (stage === "assessment") mocks.assessSubmission.mockRejectedValue(error);
    if (stage === "persistence") mocks.createModeration.mockRejectedValue(error);

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: { status: "failed", approvalReason: expect.stringContaining("retry after a minute") }
    });
    expect(console.warn).toHaveBeenCalledWith("[story-continuation] preparation will retry", {
      sessionId: "session-1", errorClass: "Error"
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(error.message);
  });

  it("keeps the generated original for display and the assessed version for rendering", async () => {
    expect(await createIdleStoryContinuation("session-1")).toEqual({ id: "automatic-1", prompt: renderPrompt });

    expect(mocks.createSubmission).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: automaticSubmissionSource, status: "submitted", createdAt: new Date(nowMs)
      })
    });
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: expect.objectContaining({ rawText: generatedPrompt, normalizedText: generatedPrompt, status: "approved" })
    });
    expect(mocks.createRanking).toHaveBeenCalledWith({
      data: expect.objectContaining({ submissionId: "automatic-1", winningPrompt: renderPrompt })
    });
  });

  it("supplies chronological completed story events and prefers original audience wording", async () => {
    mocks.findRecentClips.mockResolvedValue([
      { promptText: "Provider instructions for the pearl", submission: { rawText: "The fox discovers an empty pearl shell." } },
      { promptText: "The fox arrives in an underwater city.", submission: null },
      { promptText: "Provider instructions for the forest", submission: { rawText: "The fox enters a forest door." } }
    ]);
    mocks.countSubmissions.mockResolvedValue(3);

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    const recentPrompts = [
      "The fox enters a forest door.",
      "The fox arrives in an underwater city.",
      "The fox discovers an empty pearl shell."
    ];
    const creativeContext = {
      userId: "user-1",
      artistName: "Dream Artist",
      trackName: "Dream Track",
      basePrompt: sessionFixture().basePrompt,
      creativeBible: "A continuous dream story.",
      allowedMotifs: "",
      bannedTerms: "",
      colorPalette: "teal, ember",
      motionRules: "",
      artistControlEnabled: true,
      venueSafeMode: true
    };
    expect(mocks.generatePrompt).toHaveBeenCalledWith({ session: creativeContext, recentPrompts, continuationNumber: 3 });
    expect(mocks.assessSubmission).toHaveBeenCalledWith({
      session: creativeContext, submissionText: generatedPrompt, recentWinningPrompts: recentPrompts
    });
    expect(mocks.generatePrompt.mock.calls[0][0].session).not.toHaveProperty("submissions");
    expect(mocks.generatePrompt.mock.calls[0][0].session).not.toHaveProperty("playbackState");
  });

  it("uses the current source clip for context when there are no completed render records", async () => {
    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();

    expect(mocks.generatePrompt).toHaveBeenCalledWith(expect.objectContaining({
      recentPrompts: [sessionFixture().playbackState.currentAsset.promptText]
    }));
  });

  it("leaves ordinary audience modes independent of the Twitch delivery inbox", async () => {
    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();

    expect(mocks.findTwitchConnection).not.toHaveBeenCalled();
    expect(mocks.findTwitchDelivery).not.toHaveBeenCalled();
  });

  it.each(["pending", "processing"])("waits for a %s Twitch delivery to finish before generating", async (status) => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), audienceMode: "twitch" });
    mocks.findTwitchDelivery.mockResolvedValue({ id: "delivery-1", status });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.findTwitchConnection).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
    expect(mocks.findTwitchDelivery).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        channelId: "channel-1",
        status: { in: expect.arrayContaining([status]) },
        OR: [{ attempts: { lt: 5 } }, { status: "processing", leaseUntil: { gt: new Date(nowMs) } }]
      }
    }));
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.generatePrompt).not.toHaveBeenCalled();
  });

  it("continues a Twitch story when the delivery inbox is empty", async () => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), audienceMode: "twitch" });

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.findTwitchDelivery).toHaveBeenCalled();
    expect(mocks.generatePrompt).toHaveBeenCalledOnce();
  });

  it("discards a generated draft when a Twitch delivery arrives during generation", async () => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), audienceMode: "twitch" });
    mocks.findTwitchDelivery.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "delivery-new", status: "pending" });

    expect(await createIdleStoryContinuation("session-1")).toBeNull();
    expect(mocks.generatePrompt).toHaveBeenCalledOnce();
    expect(mocks.findTwitchDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.updateSubmissions).toHaveBeenLastCalledWith({
      where: { id: "automatic-1", status: "submitted" },
      data: expect.objectContaining({ status: "rejected", approvalReason: expect.stringContaining("new input arrived") })
    });
  });

  it("continues a disconnected Twitch session without querying an unrelated delivery inbox", async () => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), audienceMode: "twitch" });
    mocks.findTwitchConnection.mockResolvedValue(null);

    expect(await createIdleStoryContinuation("session-1")).not.toBeNull();
    expect(mocks.findTwitchDelivery).not.toHaveBeenCalled();
  });

  it.each([
    { name: "an exhausted delivery with an expired lease", leaseUntil: nowMs - 1, shouldContinue: true },
    { name: "the final delivery attempt while its lease is live", leaseUntil: nowMs + 1, shouldContinue: false }
  ])("handles $name without permanently blocking the story", async ({ leaseUntil, shouldContinue }) => {
    mocks.findSession.mockResolvedValue({ ...sessionFixture(), audienceMode: "twitch" });
    mocks.findTwitchDelivery.mockImplementation(async ({ where }) => {
      const delivery = { id: "delivery-final-attempt", status: "processing", attempts: 5, leaseUntil: new Date(leaseUntil) };
      return where.OR.some((condition: { attempts?: { lt: number }; status?: string; leaseUntil?: { gt: Date } }) =>
        condition.attempts
          ? delivery.attempts < condition.attempts.lt
          : condition.status === delivery.status && condition.leaseUntil && delivery.leaseUntil > condition.leaseUntil.gt
      ) ? delivery : null;
    });

    const result = await createIdleStoryContinuation("session-1");
    expect(Boolean(result)).toBe(shouldContinue);
    expect(mocks.generatePrompt).toHaveBeenCalledTimes(shouldContinue ? 1 : 0);
  });
});
