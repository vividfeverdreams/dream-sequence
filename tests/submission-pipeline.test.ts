import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = {
    findJobs: vi.fn(),
    findSession: vi.fn(),
    findSubmission: vi.fn(),
    findGenerationHead: vi.fn(),
    createSubmission: vi.fn(),
    updateSubmission: vi.fn(),
    createModeration: vi.fn(),
    createRanking: vi.fn(),
    assessSubmission: vi.fn(),
    checkSubmissionRateLimit: vi.fn(),
    recordAuditEvent: vi.fn(),
    claimSession: vi.fn(),
    createAsset: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    updateAsset: vi.fn(),
    updateManyJobs: vi.fn(),
    claimSubmission: vi.fn(),
    promoteOldestReadyAsset: vi.fn(),
    takePlaybackAsset: vi.fn(),
    reconcileRenderJob: vi.fn(),
    failRenderJob: vi.fn(),
    startVideoRender: vi.fn()
  };
  const transactionClient = {
    dJSession: {
      findUnique: values.findSession,
      updateMany: values.claimSession
    },
    promptSubmission: {
      findUnique: values.findSubmission,
      create: values.createSubmission,
      update: values.updateSubmission,
      updateMany: values.claimSubmission
    },
    moderationResult: { create: values.createModeration },
    rankingResult: { create: values.createRanking },
    renderJob: {
      create: values.createJob,
      findFirst: values.findGenerationHead,
      update: values.updateJob
    },
    visualAsset: {
      create: values.createAsset,
      update: values.updateAsset
    }
  };

  return {
    ...values,
    runTransaction: vi.fn(
      async (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient)
    )
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findSession
    },
    promptSubmission: {
      findUnique: mocks.findSubmission
    },
    renderJob: {
      create: mocks.createJob,
      findMany: mocks.findJobs,
      update: mocks.updateJob,
      updateMany: mocks.updateManyJobs
    },
    visualAsset: {
      create: mocks.createAsset
    },
    $transaction: mocks.runTransaction
  }
}));

vi.mock("@/lib/rendering", () => ({
  failRenderJob: mocks.failRenderJob,
  formatVideoModerationFailureReason: (message: string) => message,
  getVideoProviderFailureCode: () => null,
  isVideoModerationError: vi.fn().mockReturnValue(false),
  reconcileRenderJob: mocks.reconcileRenderJob,
  startVideoRender: mocks.startVideoRender
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: mocks.promoteOldestReadyAsset
}));

vi.mock("@/lib/playback-transition", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/playback-transition")>();

  return {
    ...actual,
    takePlaybackAsset: mocks.takePlaybackAsset
  };
});

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));

vi.mock("@/lib/ai-assessment", () => ({
  assessSubmission: mocks.assessSubmission
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSubmissionRateLimit: mocks.checkSubmissionRateLimit
}));

import {
  attemptAutomatedSelection,
  ingestSubmission,
  queueAutomatedRender,
  reconcilePendingRenderJobs
} from "@/lib/submission-pipeline";
import {
  readyPlaybackStallMs,
  shouldRecoverReadyPlaybackAsset
} from "@/lib/playback-transition";
import {
  providerCameraContinuityRequirement,
  providerOpeningFrameContinuityRequirement,
  providerSeamlessLoopRequirement
} from "@/lib/video-prompt-budget";

describe("submission receipt scheduling", () => {
  const input = {
    sessionCode: "STORY",
    source: "twitch" as const,
    prompt: "The fox discovers an underwater city.",
    sender: "Viewer",
    senderFingerprintSeed: "twitch:viewer-1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({
      id: "session-1", status: "live", audienceMode: "twitch",
      artistControlEnabled: true, auditEvents: [], submissions: []
    });
    mocks.createSubmission.mockResolvedValue({ id: "submission-1" });
    mocks.checkSubmissionRateLimit.mockResolvedValue({ allowed: true });
    mocks.assessSubmission.mockResolvedValue({
      decision: "approved", score: 90, flags: [], explanation: "Safe story idea.",
      approvalReason: "Approved.", noveltyScore: 90, cohesionScore: 90, remixDeltaScore: 90,
      winningPrompt: input.prompt
    });
  });

  it("returns a persisted receipt without waiting for provider setup", async () => {
    const scheduleSelection = vi.fn();
    const result = await ingestSubmission(input, { scheduleSelection });

    expect(result).toMatchObject({ status: "approved", submissionId: "submission-1" });
    expect(mocks.updateSubmission).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "submission-1" }, data: expect.objectContaining({ status: "approved" })
    }));
    expect(scheduleSelection).toHaveBeenCalledTimes(1);
    expect(scheduleSelection).toHaveBeenCalledWith("session-1");
    expect(mocks.findSession).toHaveBeenCalledTimes(1);
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("keeps the receipt successful when scheduling fails after the idea is saved", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await ingestSubmission(input, {
        scheduleSelection: () => { throw new Error("Background task unavailable"); }
      });
      expect(result).toMatchObject({ status: "approved", submissionId: "submission-1" });
      expect(warning).toHaveBeenCalledWith("[submission-intake] selection scheduling will retry", {
        sessionId: "session-1"
      });
    } finally {
      warning.mockRestore();
    }
  });

  it("does not schedule a rejected idea", async () => {
    mocks.assessSubmission.mockResolvedValue({
      decision: "rejected", score: 0, flags: ["blocked-term"], explanation: "Unsafe request.",
      approvalReason: "Rejected.", noveltyScore: 0, cohesionScore: 0, remixDeltaScore: 0,
      winningPrompt: input.prompt
    });
    const scheduleSelection = vi.fn();

    expect(await ingestSubmission(input, { scheduleSelection })).toMatchObject({ status: "rejected" });
    expect(scheduleSelection).not.toHaveBeenCalled();
  });

  it("returns the saved receipt and schedules rendering even if the activity log fails", async () => {
    mocks.recordAuditEvent.mockRejectedValueOnce(new Error("Audit database unavailable"));
    const scheduleSelection = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await ingestSubmission(input, { scheduleSelection })).toMatchObject({
        status: "approved", submissionId: "submission-1"
      });
      expect(scheduleSelection).toHaveBeenCalledWith("session-1");
      expect(warning).toHaveBeenCalledWith("[submission-intake] activity logging failed after receipt was saved", {
        sessionId: "session-1", submissionId: "submission-1"
      });
    } finally {
      warning.mockRestore();
    }
  });
});

describe("ready playback recovery", () => {
  it("preserves a freshly staged next asset for the show introduction", () => {
    const now = Date.parse("2026-08-18T20:00:00.000Z");

    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-next",
        nextAssetId: "asset-next",
        readyAssetUpdatedAt: new Date(now - readyPlaybackStallMs + 1),
        now
      })
    ).toBe(false);
  });

  it("recovers a staged asset only after the show has had time to introduce it", () => {
    const now = Date.parse("2026-08-18T20:00:00.000Z");

    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-next",
        nextAssetId: "asset-next",
        readyAssetUpdatedAt: new Date(now - readyPlaybackStallMs),
        now
      })
    ).toBe(true);
  });

  it("immediately recovers an orphan ready asset", () => {
    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-orphan",
        nextAssetId: null,
        readyAssetUpdatedAt: new Date(),
        now: Date.now()
      })
    ).toBe(true);
  });
});

describe("submission render queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promoteOldestReadyAsset.mockResolvedValue(null);
    mocks.takePlaybackAsset.mockResolvedValue(true);
    mocks.updateManyJobs.mockResolvedValue({
      count: 1
    });
    mocks.claimSession.mockResolvedValue({
      count: 1
    });
    mocks.claimSubmission.mockResolvedValue({
      count: 1
    });
    mocks.updateJob.mockResolvedValue({});
    mocks.updateAsset.mockResolvedValue({});
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-current",
        promptText: "Current source prompt",
        sourceVideoId: "file_current",
        publicUrl: "https://example.com/current.mp4",
        status: "live"
      }
    });
  });

  function prepareAcceptedSeed() {
    mocks.findSession.mockResolvedValue({
      id: "session-1", status: "live", userId: "user-1", basePrompt: "A doorway opens.",
      videoModel: "h3_max", videoDurationSeconds: 5, videoResolution: "480P",
      playbackState: { currentAssetId: null }, renderJobs: [], visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-new" });
    mocks.createJob.mockResolvedValue({ id: "render-new" });
    mocks.startVideoRender.mockResolvedValue({ kind: "live", requestId: "fal-known-id", outputUri: null, strategy: "fal_text_to_video" });
    mocks.failRenderJob.mockResolvedValue({ failed: true });
  }

  it("retries saving the same accepted request ID without submitting another billable clip", async () => {
    prepareAcceptedSeed();
    mocks.updateManyJobs.mockRejectedValueOnce(new Error("DB response lost")).mockResolvedValueOnce({ count: 1 });
    expect(await queueAutomatedRender("session-1", null, "seed", "A doorway opens.")).toEqual({ id: "render-new" });
    expect(mocks.startVideoRender).toHaveBeenCalledTimes(1);
    expect(mocks.updateManyJobs).toHaveBeenCalledTimes(2);
    expect(mocks.updateManyJobs.mock.calls[0][0]).toEqual(mocks.updateManyJobs.mock.calls[1][0]);
    expect(mocks.updateManyJobs.mock.calls[1][0].where.OR).toContainEqual({ providerRequestId: "fal-known-id" });
    expect(mocks.failRenderJob).not.toHaveBeenCalled();
  });

  it("suppresses automatic retry if an accepted provider ID cannot be saved", async () => {
    prepareAcceptedSeed();
    mocks.updateManyJobs.mockRejectedValue(new Error("DB unavailable"));
    expect(await queueAutomatedRender("session-1", null, "seed", "A doorway opens.")).toBeNull();
    expect(mocks.startVideoRender).toHaveBeenCalledTimes(1);
    expect(mocks.updateManyJobs).toHaveBeenCalledTimes(3);
    expect(mocks.failRenderJob).toHaveBeenCalledWith("render-new", expect.stringContaining("accepted this clip"), { providerFailureCode: "FAL_SUBMISSION_UNKNOWN", retryAllowed: false });
  });

  it.each([{ status: "stopped", emergencyPaused: false }, { status: "live", emergencyPaused: true }])("does not generate if the story stops or pauses during selection: %j", async ({ status, emergencyPaused }) => {
    prepareAcceptedSeed();
    mocks.findSession.mockResolvedValue({ id: "session-1", status, playbackState: { emergencyPaused }, renderJobs: [], visualAssets: [] });
    expect(await queueAutomatedRender("session-1", "submission-1", "remix", "Continue")).toBeNull();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("selects the next approved prompt after a render frees the slot", async () => {
    mocks.findJobs.mockResolvedValue([
      {
        id: "render-current",
        status: "in_progress"
      }
    ]);
    mocks.reconcileRenderJob.mockResolvedValue({
      status: "completed",
      progress: 100
    });
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-ready",
          lastTransitionAt: new Date(0),
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "Compiled private model prompt"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        imageReferenceUrl: null,
        videoModel: "h3_max",
        videoDurationSeconds: 6,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: null
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-next" });
    mocks.createJob.mockResolvedValue({ id: "render-next" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: "https://example.com/reference.jpg"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-next",
      outputUri: "https://example.com/generated.mp4",
      strategy: "fal_h3_max_image_to_video"
    });
    mocks.updateJob.mockResolvedValue({});

    const updates = await reconcilePendingRenderJobs("session-1");

    expect(updates).toEqual([
      {
        id: "render-current",
        status: "completed",
        progress: 100
      }
    ]);
    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSubmissionId: "submission-next",
        promptText: "Compiled private model prompt",
        durationSeconds: 6
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "remix",
        prompt: expect.stringContaining("Compiled private model prompt"),
        videoModel: "h3_max",
        durationSeconds: 6
      })
    );

  });

  it("renders an approved prompt while an archived rotation clip occupies the next slot", async () => {
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-archived-next",
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "A fresh audience remix"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        imageReferenceUrl: null,
        videoDurationSeconds: 8,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-archived-next"
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-new" });
    mocks.createJob.mockResolvedValue({ id: "render-new" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-new",
      outputUri: null,
      strategy: "fal_h3_max_image_to_video"
    });
    mocks.updateJob.mockResolvedValue({});

    await expect(attemptAutomatedSelection("session-1")).resolves.toEqual({
      id: "render-new"
    });

    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSubmissionId: "submission-next",
        promptText: "A fresh audience remix",
        status: "processing"
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "remix",
        prompt: expect.stringContaining("A fresh audience remix"),
        sourceVideoUrl: "https://example.com/current.mp4"
      })
    );
  });

  it("remixes the newest generated asset even while an older rotation clip is live", async () => {
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-2",
        sourceVideoId: "v1_remix-2",
        publicUrl: "https://example.com/remix-2.mp4",
        status: "archived"
      }
    });
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-original",
          nextAssetId: "asset-remix-1",
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-remix-3",
            rankingResult: {
              score: 99,
              winningPrompt: "Turn the latest remix into a glass forest"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        imageReferenceUrl: null,
        videoDurationSeconds: 4,
        playbackState: {
          currentAssetId: "asset-original",
          nextAssetId: "asset-remix-1"
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-remix-3" });
    mocks.createJob.mockResolvedValue({ id: "render-remix-3" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-3",
      outputUri: null,
      strategy: "fal_h3_max_image_to_video"
    });

    await attemptAutomatedSelection("session-1");

    expect(mocks.findGenerationHead).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        status: "completed"
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ],
      select: {
        outputAsset: {
          select: {
            id: true,
            promptText: true,
            publicUrl: true,
            thumbnailUrl: true,
            sourceVideoId: true,
            status: true
          }
        }
      }
    });
    expect(mocks.createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceAssetId: "asset-remix-2",
        outputAssetId: "asset-remix-3"
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 5,
        mode: "remix",
        sourceVideoUrl: "https://example.com/remix-2.mp4"
      })
    );
  });

  it("preserves a full audience story idea and persists exactly what H3 Max receives", async () => {
    const rawPrompt = `She opens the door and finds a city inside a star. ${"A".repeat(1100)}`;
    const opening = "An astronaut finds a door in a desert.";
    mocks.findSession.mockResolvedValue({
      id: "session-1", userId: "user-1", status: "live", updatedAt: new Date(),
      basePrompt: opening, videoModel: "h3_max", videoDurationSeconds: 10, videoResolution: "1080P",
      motionRules: "OBSOLETE_CAMERA_RULE", venueSafeMode: true,
      playbackState: { currentAssetId: "asset-current", nextAssetId: null }, renderJobs: [], visualAssets: []
    });
    mocks.findSubmission.mockResolvedValue({ rawText: rawPrompt });
    mocks.createAsset.mockResolvedValue({ id: "asset-next" });
    mocks.createJob.mockResolvedValue({ id: "render-next" });
    mocks.startVideoRender.mockResolvedValue({ kind: "live", requestId: "request-next", outputUri: null, strategy: "fal_h3_max_image_to_video" });

    await queueAutomatedRender("session-1", "submission-next", "remix", "A shortened assessment should not replace the story");

    const finalProviderPrompt = mocks.startVideoRender.mock.calls[0][0].prompt as string;
    expect(finalProviderPrompt).toContain(rawPrompt);
    expect(finalProviderPrompt).toContain(opening);
    expect(finalProviderPrompt).toContain("Story opening (background only; do not restart)");
    expect(finalProviderPrompt).toContain(providerOpeningFrameContinuityRequirement);
    expect(finalProviderPrompt).toContain(providerSeamlessLoopRequirement);
    expect(finalProviderPrompt).toContain("do not loop back");
    expect(finalProviderPrompt).not.toContain("Venue-safe:");
    expect(finalProviderPrompt).not.toContain("OBSOLETE_CAMERA_RULE");
    expect(finalProviderPrompt).not.toContain("A shortened assessment");
    expect(finalProviderPrompt.length).toBeLessThanOrEqual(3000);
    expect(mocks.updateJob).toHaveBeenCalledWith({ where: { id: "render-next" }, data: { promptText: finalProviderPrompt } });
    expect(mocks.updateAsset).toHaveBeenCalledWith({ where: { id: "asset-next" }, data: { promptText: finalProviderPrompt } });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(expect.objectContaining({
      mode: "remix", videoModel: "h3_max", resolution: "1080P", durationSeconds: 10,
      sourceVideoUrl: "https://example.com/current.mp4", prompt: finalProviderPrompt
    }));
    expect(mocks.startVideoRender.mock.calls[0][0]).not.toHaveProperty("remixReferenceImageUrl");
  });

  it("uses the opening story for the first scene without a rewrite or legacy camera rules", async () => {
    const opening = "A prismatic city made from liquid mirrors. ".repeat(25);
    mocks.findSession.mockResolvedValue({
      id: "session-1", userId: "user-1", status: "live", updatedAt: new Date(),
      basePrompt: opening, videoModel: "h3_max", videoDurationSeconds: 5, videoResolution: "480P",
      motionRules: "OBSOLETE_CAMERA_RULE", venueSafeMode: false,
      playbackState: { currentAssetId: null, nextAssetId: null }, renderJobs: [], visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-seed" });
    mocks.createJob.mockResolvedValue({ id: "render-seed" });
    mocks.startVideoRender.mockResolvedValue({ kind: "live", requestId: "request-seed", outputUri: null, strategy: "fal_h3_max_image_to_video" });

    await queueAutomatedRender("session-1", null, "seed", "A stale legacy draft");

    const prompt = mocks.startVideoRender.mock.calls[0][0].prompt as string;
    expect(prompt).toContain(opening.trim());
    expect(prompt).not.toContain("A stale legacy draft");
    expect(prompt).not.toContain("OBSOLETE_CAMERA_RULE");
    expect(prompt).not.toContain("Venue-safe:");
    expect(prompt).toContain(providerSeamlessLoopRequirement);
    expect(mocks.findGenerationHead).not.toHaveBeenCalled();
    expect(mocks.findSubmission).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).toHaveBeenCalledWith(expect.objectContaining({ resolution: "480P", durationSeconds: 5 }));
  });

  it("uses the host continuation directly when generating without an audience submission", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1", userId: "user-1", status: "live", updatedAt: new Date(),
      basePrompt: "An astronaut finds a door in a desert.", videoModel: "h3_max", videoDurationSeconds: 8,
      venueSafeMode: true, playbackState: { currentAssetId: "asset-current", nextAssetId: null }, renderJobs: [], visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-next" });
    mocks.createJob.mockResolvedValue({ id: "render-next" });
    mocks.startVideoRender.mockResolvedValue({ kind: "live", requestId: "request-next", outputUri: null, strategy: "fal_h3_max_image_to_video" });

    await queueAutomatedRender("session-1", null, "remix", "The door opens into an ember cathedral");

    const prompt = mocks.startVideoRender.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("What happens next: The door opens into an ember cathedral");
    expect(prompt).toContain(providerOpeningFrameContinuityRequirement);
    expect(prompt).toContain(providerCameraContinuityRequirement);
    expect(mocks.findSubmission).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
  });

  it("fails closed when final prompt persistence transiently fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-2",
        promptText: "Current source prompt",
        sourceVideoId: "v1_remix-2",
        publicUrl: "https://example.com/remix-2.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      videoResolution: "1080P",
      updatedAt: new Date("2026-08-19T10:00:00.000Z"),
      artistName: "Neon Echo",
      trackName: "Skyline Pressure",
      creativeBible: "Reflective dream architecture",
      allowedMotifs: "prisms",
      bannedTerms: "logos",
      colorPalette: "cobalt and ember",
      motionRules: "clockwise orbit",
      basePrompt: "An endless mirrored desert",
      imageReferenceUrl: null,
      videoModel: "h3_max",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-2",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-remix-3" });
    mocks.createJob.mockResolvedValue({ id: "render-remix-3" });
    mocks.updateJob.mockRejectedValueOnce(new Error("transient database error"));
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "seedance-request-3",
      outputUri: null,
      strategy: "fal_h3_max_image_to_video"
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Approved fallback prompt"
      )
    ).resolves.toBeNull();

    expect(mocks.startVideoRender).not.toHaveBeenCalled();
    expect(mocks.failRenderJob).toHaveBeenCalledWith(
      "render-remix-3",
      "The final provider prompt could not be persisted."
    );
    expect(warn).toHaveBeenCalledWith(
      "[provider-prompt] could not persist final prompt",
      expect.objectContaining({
        renderJobId: "render-remix-3"
      })
    );
    warn.mockRestore();
  });

  it("never revives a render that became terminal before fal returned", async () => {
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-1",
        sourceVideoId: "v1_remix-1",
        publicUrl: "https://example.com/remix-1.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({
      id: "asset-remix-2"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-remix-2"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-2",
      outputUri: "https://example.com/remix-2.mp4",
      strategy: "fal_h3_max_image_to_video"
    });
    mocks.updateManyJobs.mockResolvedValue({
      count: 0
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix glow"
      )
    ).resolves.toBeNull();

    expect(mocks.updateManyJobs).toHaveBeenCalledWith({
      where: {
        id: "render-remix-2",
        status: "queued",
        OR: [{ providerRequestId: null }, { providerRequestId: "v1_remix-2" }]
      },
      data: {
        providerRequestId: "v1_remix-2",
        providerOutputUri: "https://example.com/remix-2.mp4",
        providerStrategy: "fal_h3_max_image_to_video",
        status: "queued",
        failureReason: null
      }
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "h3_max"
      })
    );
  });

  it("normalizes a stored duration against the selected video model", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      videoResolution: "1080P",
      updatedAt: new Date("2026-08-14T12:00:00.000Z"),
      imageReferenceUrl: null,
      videoModel: "h3_max",
      basePrompt: "An astronaut finds a door in a desert.",
      videoDurationSeconds: 4,
      playbackState: {
        currentAssetId: null,
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({
      id: "asset-h3-seed"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-h3-seed"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "h3-request",
      outputUri: null,
      strategy: "text_to_video"
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "seed",
        "Shape an iridescent H3 seed"
      )
    ).resolves.toEqual({
      id: "render-h3-seed"
    });

    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        durationSeconds: 5
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "h3_max",
        durationSeconds: 5
      })
    );
  });

  it("allows only one concurrent render to claim the generation head", async () => {
    const updatedAt = new Date("2026-07-29T04:00:00.000Z");
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
      updatedAt,
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-1",
        sourceVideoId: "v1_remix-1",
        publicUrl: "https://example.com/remix-1.mp4",
        status: "live"
      }
    });
    mocks.claimSession
      .mockResolvedValueOnce({
        count: 1
      })
      .mockResolvedValueOnce({
        count: 0
      });
    mocks.createAsset.mockResolvedValue({
      id: "asset-remix-2"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-remix-2"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-2",
      outputUri: null,
      strategy: "fal_h3_max_image_to_video"
    });

    const results = await Promise.all([
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix glow"
      ),
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix crystalline"
      )
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mocks.claimSession).toHaveBeenCalledTimes(2);
    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.startVideoRender).toHaveBeenCalledTimes(1);
    expect(
      (mocks.claimSession.mock.calls[0]?.[0] as {
        data: {
          updatedAt: Date;
        };
      }).data.updatedAt.getTime()
    ).toBeGreaterThan(updatedAt.getTime());
  });

  it("fails closed instead of skipping an unusable newest completed remix", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      videoResolution: "1080P",
      updatedAt: new Date("2026-07-29T04:00:00.000Z"),
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-older-live",
        nextAssetId: null,
        currentAsset: {
          id: "asset-older-live",
          publicUrl: "https://example.com/older-live.mp4",
          sourceVideoId: "v1_older-live"
        }
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-newest-unusable",
        sourceVideoId: "v1_newest",
        publicUrl: null,
        status: "failed"
      }
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Continue only from the newest remix"
      )
    ).resolves.toBeNull();

    expect(mocks.claimSession).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("does not strand a submission when its atomic selection claim is lost", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      videoResolution: "1080P",
      updatedAt: new Date("2026-07-29T04:00:00.000Z"),
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.claimSubmission.mockResolvedValue({
      count: 0
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        "submission-already-claimed",
        "remix",
        "Make the latest remix crystalline"
      )
    ).resolves.toBeNull();

    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-already-claimed",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("recovers a fresh ready asset and continues with the next approved render", async () => {
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: null,
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [
          {
            id: "asset-ready"
          }
        ],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "Wait for the ready asset"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
        updatedAt: new Date("2026-07-29T17:54:00.000Z"),
        videoDurationSeconds: 4,
        playbackState: {
          currentAssetId: "asset-ready",
          currentAsset: {
            id: "asset-ready",
            publicUrl: "https://example.com/ready.mp4",
            sourceVideoId: "video-ready",
            status: "live"
          }
        },
        renderJobs: [],
        visualAssets: []
      });

    mocks.createAsset.mockResolvedValue({
      id: "asset-next"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-next",
      outputAsset: {
        id: "asset-next"
      }
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-next",
      outputUri: null,
      strategy: "fal_h3_max_image_to_video"
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toMatchObject({
      id: "render-next"
    });

    expect(mocks.takePlaybackAsset).toHaveBeenCalledWith(
      "session-1",
      "asset-ready"
    );
    expect(mocks.promoteOldestReadyAsset).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      {
        allowArchivedRotation: false
      }
    );
    expect(mocks.claimSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "submission-next"
        })
      })
    );
    expect(mocks.startVideoRender).toHaveBeenCalled();
  });

  it("does not render while another render is active", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-current",
        nextAssetId: "asset-archived-next",
        emergencyPaused: false
      },
      renderJobs: [
        {
          id: "render-active",
          status: "in_progress"
        }
      ],
      visualAssets: [],
      submissions: [
        {
          id: "submission-next",
          rankingResult: {
            score: 92,
            winningPrompt: "Wait for the active render"
          }
        }
      ]
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.promoteOldestReadyAsset).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("keeps automated selection from staging archived rotation", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-current",
        nextAssetId: null,
        emergencyPaused: false
      },
      renderJobs: [],
      visualAssets: [],
      submissions: []
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.promoteOldestReadyAsset).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      {
        allowArchivedRotation: false
      }
    );
  });

  it("does not immediately undo a fresh transition by taking its staged ready backlog", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      basePrompt: "An astronaut finds a door in a desert.",
      videoResolution: "1080P",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-manual",
        nextAssetId: "asset-ready-backlog",
        lastTransitionAt: new Date(0),
        emergencyPaused: false
      },
      renderJobs: [],
      visualAssets: [
        {
          id: "asset-ready-backlog",
          updatedAt: new Date()
        }
      ],
      submissions: [
        {
          id: "submission-next",
          rankingResult: {
            score: 92,
            winningPrompt: "Do not undo the manual take"
          }
        }
      ]
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.takePlaybackAsset).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });
});
