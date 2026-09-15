import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwnedSession: vi.fn(),
  findRecoverySession: vi.fn(),
  findLatestSeed: vi.fn(),
  claimRecoverySession: vi.fn(),
  claimRecoveryJob: vi.fn(),
  claimRecoveryAsset: vi.fn(),
  reconcileRenderJob: vi.fn(),
  updateSession: vi.fn(),
  findGenerationState: vi.fn(),
  findPlayback: vi.fn(),
  updatePlaybackMany: vi.fn(),
  updateAsset: vi.fn(),
  queueAutomatedRender: vi.fn(),
  recordAuditEvent: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (callback) =>
      callback({
        dJSession: { findUnique: mocks.findRecoverySession, updateMany: mocks.claimRecoverySession },
        renderJob: { findFirst: mocks.findLatestSeed, updateMany: mocks.claimRecoveryJob },
        playbackState: {
          updateMany: mocks.updatePlaybackMany
        },
        visualAsset: {
          update: mocks.updateAsset,
          updateMany: mocks.claimRecoveryAsset
        }
      })
    ),
    dJSession: {
      findFirst: mocks.findOwnedSession,
      update: mocks.updateSession,
      findUnique: mocks.findGenerationState
    },
    playbackState: {
      findUnique: mocks.findPlayback
    }
  }
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: vi.fn()
}));

vi.mock("@/lib/submission-pipeline", () => ({
  queueAutomatedRender: mocks.queueAutomatedRender
}));

vi.mock("@/lib/rendering", () => ({ reconcileRenderJob: mocks.reconcileRenderJob }));

import {
  buildFallbackRemixPrompt,
  initialGenerationRecoveryFailureMessage,
  initialGenerationQueueFailureMessage,
  startDjSession
} from "@/lib/session-service";

describe("starting a session's first video", () => {
  const startedAt = new Date("2026-07-29T14:30:41.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRecoverySession.mockResolvedValue({ userId: "user-1", updatedAt: startedAt, playbackState: { currentAssetId: null }, renderJobs: [] });
    mocks.findLatestSeed.mockResolvedValue(null);
    mocks.claimRecoverySession.mockResolvedValue({ count: 1 });
    mocks.claimRecoveryJob.mockResolvedValue({ count: 1 });
    mocks.claimRecoveryAsset.mockResolvedValue({ count: 1 });
    mocks.reconcileRenderJob.mockResolvedValue({ status: "completed", progress: 100 });
    mocks.findOwnedSession.mockResolvedValue({
      id: "session-1"
    });
    mocks.updateSession.mockResolvedValue({
      id: "session-1",
      name: "Live set",
      basePrompt: "A liquid chrome dream",
      motionRules: "Locked-off static camera; pulse the light on phrase changes",
      status: "live",
      startedAt,
      playbackState: {
        currentAssetId: null
      },
      renderJobs: []
    });
    mocks.recordAuditEvent.mockResolvedValue({});
    mocks.updatePlaybackMany.mockResolvedValue({
      count: 1
    });
    mocks.updateAsset.mockResolvedValue({});
  });

  const recoverableSeed = {
    id: "seed-existing", mode: "seed", status: "failed", submissionId: null,
    providerStrategy: "fal_image_to_video", providerRequestId: "fal-existing",
    providerOutputUri: "https://media.fal.ai/private-existing-output.mp4", outputAssetId: "asset-existing",
    failureReason: "Could not load the node-av native binding PRIVATE_MESSAGE", outputAsset: { status: "failed" },
    createdAt: new Date("2026-07-29T13:00:00.000Z")
  };

  it("recovers the same old failed fal seed and asset without submitting another generation", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.findLatestSeed.mockResolvedValue(recoverableSeed);

    await expect(startDjSession("session-1", "user-1")).resolves.toMatchObject({ id: "session-1" });

    expect(mocks.findLatestSeed).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: "session-1", mode: "seed" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    }));
    expect(mocks.claimRecoverySession).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "session-1", userId: "user-1", updatedAt: startedAt,
        playbackState: { is: { currentAssetId: null } }, renderJobs: { none: { status: { in: ["queued", "in_progress"] } } } })
    }));
    expect(mocks.claimRecoveryJob).toHaveBeenCalledWith({
      where: { id: "seed-existing", sessionId: "session-1", mode: "seed", status: "failed", submissionId: null,
        providerStrategy: "fal_image_to_video", providerRequestId: "fal-existing", providerOutputUri: recoverableSeed.providerOutputUri, outputAssetId: "asset-existing" },
      data: { status: "in_progress", failureReason: null, providerFailureCode: null, completedAt: null, lastPolledAt: null }
    });
    expect(mocks.claimRecoveryAsset).toHaveBeenCalledWith({ where: { id: "asset-existing", sessionId: "session-1", status: "failed" }, data: { status: "processing" } });
    expect(mocks.reconcileRenderJob).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileRenderJob).toHaveBeenCalledWith("seed-existing");
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[session-start] recovering existing seed", {
      sessionId: "session-1", renderJobId: "seed-existing", providerRequestId: "fal-existing", previousFailureCode: "NATIVE_BINDING_UNAVAILABLE"
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_MESSAGE");
    expect(JSON.stringify(log.mock.calls)).not.toContain("https://");
    expect(mocks.claimRecoveryJob.mock.calls[0][0].data).not.toHaveProperty("createdAt");
    log.mockRestore();
  });

  it.each(["failed", "throws"])("never submits a replacement if existing clip recovery %s", async (outcome) => {
    mocks.findLatestSeed.mockResolvedValue(recoverableSeed);
    if (outcome === "failed") mocks.reconcileRenderJob.mockResolvedValue({ status: "failed", progress: null });
    else mocks.reconcileRenderJob.mockRejectedValue(new Error("Storage could not complete"));
    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(initialGenerationRecoveryFailureMessage);
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
  });

  it("rejects recovery from a different owner before changing or generating anything", async () => {
    mocks.findOwnedSession.mockResolvedValue(null);
    await expect(startDjSession("session-1", "intruder")).rejects.toThrow("Session not found.");
    expect(mocks.findOwnedSession).toHaveBeenCalledWith({ where: { id: "session-1", userId: "intruder" } });
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(mocks.claimRecoveryJob).not.toHaveBeenCalled();
    expect(mocks.reconcileRenderJob).not.toHaveBeenCalled();
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
  });

  it("allows only one concurrent recovery claim and never charges the losing request", async () => {
    mocks.findLatestSeed.mockResolvedValue(recoverableSeed);
    mocks.claimRecoverySession.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await Promise.all([startDjSession("session-1", "user-1"), startDjSession("session-1", "user-1")]);
    expect(mocks.claimRecoveryJob).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileRenderJob).toHaveBeenCalledTimes(1);
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
  });

  it("does not queue a replacement when the exact failed-job claim loses a race", async () => {
    mocks.findLatestSeed.mockResolvedValue(recoverableSeed);
    mocks.claimRecoveryJob.mockResolvedValue({ count: 0 });
    await startDjSession("session-1", "user-1");
    expect(mocks.claimRecoveryAsset).not.toHaveBeenCalled();
    expect(mocks.reconcileRenderJob).not.toHaveBeenCalled();
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
  });

  it("stops before generating when a concurrent recovery already filled playback or the render slot", async () => {
    mocks.findRecoverySession.mockResolvedValue({ userId: "user-1", updatedAt: startedAt, playbackState: { currentAssetId: null }, renderJobs: [{ id: "seed-existing" }] });
    await startDjSession("session-1", "user-1");
    expect(mocks.findLatestSeed).not.toHaveBeenCalled();
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
    expect(mocks.reconcileRenderJob).not.toHaveBeenCalled();
  });

  it("fails without generating if the existing failed asset cannot be reclaimed", async () => {
    mocks.findLatestSeed.mockResolvedValue(recoverableSeed);
    mocks.claimRecoveryAsset.mockResolvedValue({ count: 0 });
    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(initialGenerationRecoveryFailureMessage);
    expect(mocks.queueAutomatedRender).not.toHaveBeenCalled();
    expect(mocks.reconcileRenderJob).not.toHaveBeenCalled();
  });

  it("fails explicitly when no first-video job was created", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [],
      visualAssets: []
    });

    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(
      initialGenerationQueueFailureMessage
    );
    expect(mocks.findGenerationState).toHaveBeenCalledWith({
      where: {
        id: "session-1"
      },
      select: expect.objectContaining({
        playbackState: expect.any(Object),
        renderJobs: expect.any(Object)
      })
    });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("accepts a concurrent seed job instead of reporting a false failure", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [
        {
          id: "seed-concurrent"
        }
      ],
      visualAssets: []
    });

    await expect(startDjSession("session-1", "user-1")).resolves.toMatchObject({
      id: "session-1",
      status: "live"
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        sessionId: "session-1"
      })
    );
  });

  it("fails explicitly when the generation state cannot be recovered", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue(null);

    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(
      initialGenerationQueueFailureMessage
    );
  });

  it("adopts a completed ready seed when playback was never assigned", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [],
      visualAssets: [
        {
          id: "asset-ready"
        }
      ]
    });

    await expect(startDjSession("session-1", "user-1")).resolves.toMatchObject({
      id: "session-1",
      status: "live"
    });
    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        currentAssetId: null
      },
      data: {
        currentAssetId: "asset-ready",
        status: "live",
        lastTransitionAt: expect.any(Date)
      }
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: {
        id: "asset-ready"
      },
      data: {
        status: "live"
      }
    });
  });

  it("does not perform a recovery query when the seed starts normally", async () => {
    mocks.queueAutomatedRender.mockResolvedValue({
      id: "seed-1"
    });

    await startDjSession("session-1", "user-1");

    expect(mocks.queueAutomatedRender).toHaveBeenCalledWith(
      "session-1",
      null,
      "seed",
      "A liquid chrome dream"
    );
    expect(mocks.findGenerationState).not.toHaveBeenCalled();
  });
});

describe("fallback remix creative prompt", () => {
  it("continues the story without replaying its opening", () => {
    const prompt = buildFallbackRemixPrompt({
      basePrompt: "A molten glass city loops through ultraviolet rain."
    });

    expect(prompt).toContain("A molten glass city loops through ultraviolet rain.");
    expect(prompt).toContain("one new, natural event");
    expect(prompt).toContain("without restarting the opening");
    expect(prompt).not.toContain("Follow the artist's motion and camera rules");
    expect(prompt).not.toContain("venue-safe");
    expect(prompt).not.toContain("calmer geometric pulse");
    expect(prompt).not.toContain("resilient club-safe motion");
  });
});
