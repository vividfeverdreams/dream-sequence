import { describe, expect, it } from "vitest";
import {
  acknowledgeAuthoritativePlaybackAsset,
  decideAutomaticCueTransition,
  decideManualTakeRequest,
  getAudienceFacingRemixPrompt,
  getAuthoritativeNextPlaybackCandidate,
  getAuthoritativePlaybackCandidate,
  getChronologicalPlaybackRotation,
  getIntroducedPlaybackAssetIds,
  getNextPlaybackRotationAsset,
  getPlaybackAttribution,
  getRenderableVideoSlots,
  getShowPlaybackCandidate,
  getStandbyRetryDelayMs,
  getStandbyVideoSlot,
  isCueSyncedPlaybackActive,
  isVideoSlotVisible,
  shouldAdvancePlaybackAtVideoEnd,
  shouldCommitShowPlaybackTransition,
  shouldCommitVisibleAuthoritativeNext,
  shouldHoldPlaybackForAuthoritativeCommit,
  shouldHandoffPreparedPlaybackAtBoundary,
  shouldShowPlaybackIntroduction,
  shouldStartAutomaticPlaybackTransition,
  getTypewriterChunkSize
} from "@/lib/remix-transition";

describe("remix transition cues", () => {
  const rotationAsset = (
    id: string,
    minute: number,
    kind: "seed" | "remix" = "remix"
  ) => ({
    id,
    kind,
    createdAt: new Date(`2026-07-28T12:${String(minute).padStart(2, "0")}:00.000Z`)
  });

  it("keeps the original through remix two, then rolls the newest three remixes", () => {
    const original = rotationAsset("original", 0, "seed");
    const remixes = Array.from({ length: 6 }, (_, index) =>
      rotationAsset(`remix-${index + 1}`, index + 1)
    );

    expect(
      getChronologicalPlaybackRotation([original, ...remixes.slice(0, 2)]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "original",
      "remix-1",
      "remix-2"
    ]);
    expect(
      getChronologicalPlaybackRotation([original, ...remixes.slice(0, 3)]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "remix-1",
      "remix-2",
      "remix-3"
    ]);
    expect(
      getChronologicalPlaybackRotation([original, ...remixes]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "remix-4",
      "remix-5",
      "remix-6"
    ]);
  });

  it("selects the chronological successor and wraps inside the active window", () => {
    const assets = [
      rotationAsset("original", 0, "seed"),
      ...Array.from({ length: 6 }, (_, index) =>
        rotationAsset(`remix-${index + 1}`, index + 1)
      )
    ];

    expect(getNextPlaybackRotationAsset(assets, "remix-3")?.id).toBe("remix-4");
    expect(getNextPlaybackRotationAsset(assets, "remix-4")?.id).toBe("remix-5");
    expect(getNextPlaybackRotationAsset(assets, "remix-6")?.id).toBe("remix-4");
    expect(getNextPlaybackRotationAsset(assets, "remix-1")?.id).toBe("remix-4");
  });

  it("cycles the seed and every playable remix when the show supplies the full asset count", () => {
    const assets = [
      rotationAsset("original", 0, "seed"),
      ...Array.from({ length: 6 }, (_, index) =>
        rotationAsset(`remix-${index + 1}`, index + 1)
      )
    ];
    const visitedAssetIds: string[] = [];
    let currentAssetId = assets[0].id;

    for (let index = 0; index < assets.length; index += 1) {
      visitedAssetIds.push(currentAssetId);
      currentAssetId =
        getNextPlaybackRotationAsset(
          assets,
          currentAssetId,
          assets.length
        )?.id ?? "";
    }

    expect(visitedAssetIds).toEqual([
      "original",
      "remix-1",
      "remix-2",
      "remix-3",
      "remix-4",
      "remix-5",
      "remix-6"
    ]);
    expect(currentAssetId).toBe("original");
  });

  it("keeps a musical cue pending until the next remix is ready", () => {
    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: true,
        nextAssetReady: false
      })
    ).toBe("wait-for-remix");

    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: true,
        nextAssetReady: true
      })
    ).toBe("take-remix");
  });

  it("ignores musical cues when automatic takes are disabled", () => {
    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: false,
        nextAssetReady: true
      })
    ).toBe("ignore");
  });

  it("keeps automatic remix cycling active unless cue-synced takes are explicitly enabled", () => {
    expect(
      isCueSyncedPlaybackActive({
        audioSyncConnected: true,
        autoTakeOnCue: false
      })
    ).toBe(false);
    expect(
      isCueSyncedPlaybackActive({
        audioSyncConnected: true,
        autoTakeOnCue: true
      })
    ).toBe(true);
    expect(
      isCueSyncedPlaybackActive({
        audioSyncConnected: false,
        autoTakeOnCue: true
      })
    ).toBe(false);
  });

  it("keeps retrying failed standby videos with a capped backoff", () => {
    expect(getStandbyRetryDelayMs(1)).toBe(750);
    expect(getStandbyRetryDelayMs(3)).toBe(2250);
    expect(getStandbyRetryDelayMs(20)).toBe(10_000);
    expect(getStandbyRetryDelayMs(Number.NaN)).toBe(750);
  });

  it("reveals prompts in small typewriter chunks", () => {
    expect(getTypewriterChunkSize(80)).toBe(3);
    expect(getTypewriterChunkSize(600)).toBe(6);
  });

  it("uses only the audience submission for the show overlay", () => {
    expect(getAudienceFacingRemixPrompt("  Make it on fire  ")).toBe("Make it on fire");
    expect(getAudienceFacingRemixPrompt(null)).toBe("New remix incoming.");
  });

  it("attributes a web remix to its nickname and original prompt", () => {
    expect(
      getPlaybackAttribution({
        promptText: "Private generation prompt",
        sourceSubmission: {
          rawText: "  Turn the skyline into liquid chrome  ",
          sender: "  NeonGhost  ",
          source: "web"
        }
      })
    ).toEqual({
      nickname: "NeonGhost",
      promptText: "Turn the skyline into liquid chrome"
    });
  });

  it("redacts an SMS sender from playback attribution", () => {
    expect(
      getPlaybackAttribution({
        promptText: "Private generation prompt",
        sourceSubmission: {
          rawText: "Add violet lightning",
          sender: "+13125550123",
          source: "sms"
        }
      })
    ).toEqual({
      nickname: "CROWD REMIX",
      promptText: "Add violet lightning"
    });
  });

  it("labels a seed with DREAM SEQUENCE and its asset prompt", () => {
    expect(
      getPlaybackAttribution({
        promptText: "  A slow orbit through a paper galaxy  ",
        sourceSubmission: null
      })
    ).toEqual({
      nickname: "DREAM SEQUENCE",
      promptText: "A slow orbit through a paper galaxy"
    });
  });

  it("falls back safely when attribution fields contain only whitespace", () => {
    expect(
      getPlaybackAttribution({
        promptText: "   ",
        sourceSubmission: {
          rawText: "\n\t",
          sender: "   ",
          source: "web"
        }
      })
    ).toEqual({
      nickname: "CROWD REMIX",
      promptText: "Original session visual"
    });
  });

  it("seeds introduced IDs from played assets and the current asset", () => {
    const introducedAssetIds = getIntroducedPlaybackAssetIds(
      [
        {
          id: "asset-ready",
          status: "ready"
        },
        {
          id: "asset-live",
          status: "live"
        },
        {
          id: "asset-archived",
          status: "archived"
        },
        {
          id: "asset-processing",
          status: "processing"
        },
        null
      ],
      "asset-current"
    );

    expect([...introducedAssetIds].sort()).toEqual([
      "asset-archived",
      "asset-current",
      "asset-live"
    ]);
  });

  it("acknowledges a server-current asset and dismisses its stale introduction", () => {
    const introducedAssetIds = new Set(["asset-seed"]);

    expect(
      acknowledgeAuthoritativePlaybackAsset(
        "asset-remix",
        "asset-remix",
        introducedAssetIds
      )
    ).toBe(true);
    expect(introducedAssetIds).toEqual(
      new Set(["asset-seed", "asset-remix"])
    );
  });

  it("acknowledges authoritative playback without dismissing another pending introduction", () => {
    const introducedAssetIds = new Set<string>();

    expect(
      acknowledgeAuthoritativePlaybackAsset(
        "asset-current",
        "asset-next",
        introducedAssetIds
      )
    ).toBe(false);
    expect(introducedAssetIds).toEqual(new Set(["asset-current"]));
  });

  it("shows a newly authoritative asset introduction once and skips played rotation assets", () => {
    const introducedAssetIds = new Set(["asset-seen"]);

    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-new",
          status: "ready"
        },
        introducedAssetIds
      )
    ).toBe(true);

    introducedAssetIds.add("asset-new");

    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-new",
          status: "ready"
        },
        introducedAssetIds
      )
    ).toBe(false);
    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-live",
          status: "live"
        },
        introducedAssetIds
      )
    ).toBe(true);
    introducedAssetIds.add("asset-live");
    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-live",
          status: "live"
        },
        introducedAssetIds
      )
    ).toBe(false);
    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-archived",
          status: "archived"
        },
        introducedAssetIds
      )
    ).toBe(false);
  });

  it("prioritizes a server-authoritative current asset that differs from the visible slot", () => {
    const authoritativeAsset = {
      id: "asset-server-current"
    };

    expect(
      getAuthoritativePlaybackCandidate(authoritativeAsset, "asset-visible")
    ).toBe(authoritativeAsset);
    expect(
      getAuthoritativePlaybackCandidate(authoritativeAsset, authoritativeAsset.id)
    ).toBeNull();
    expect(
      getAuthoritativePlaybackCandidate(null, "asset-visible")
    ).toBeNull();
  });

  it("does not mistake the outgoing server snapshot for a rollback while its queued next asset is already visible", () => {
    expect(
      getAuthoritativePlaybackCandidate(
        {
          id: "asset-outgoing"
        },
        "asset-incoming",
        "asset-incoming",
        "asset-incoming"
      )
    ).toBeNull();
  });

  it("does not suppress a server current change just because the old visible asset rotated into next", () => {
    const authoritativeAsset = {
      id: "asset-server-current"
    };

    expect(
      getAuthoritativePlaybackCandidate(
        authoritativeAsset,
        "asset-old-visible",
        "asset-old-visible",
        null
      )
    ).toBe(authoritativeAsset);
  });

  it("suppresses only the unchanged server current during local display rotation", () => {
    const oldServerCurrent = {
      id: "asset-server-old"
    };
    const newServerCurrent = {
      id: "asset-server-new"
    };

    expect(
      getAuthoritativePlaybackCandidate(
        oldServerCurrent,
        "asset-local-rotation",
        null,
        null,
        oldServerCurrent.id
      )
    ).toBeNull();
    expect(
      getAuthoritativePlaybackCandidate(
        newServerCurrent,
        "asset-local-rotation",
        null,
        null,
        oldServerCurrent.id
      )
    ).toBe(newServerCurrent);
  });

  it("keeps an authoritative next asset eligible while the display rotates locally", () => {
    const queuedNext = {
      id: "asset-fresh-next"
    };

    expect(
      getAuthoritativeNextPlaybackCandidate({
        currentAssetId: "asset-server-current",
        activeAssetId: "asset-archived-local",
        nextAsset: queuedNext,
        localRotationAuthoritativeAssetId: "asset-server-current"
      })
    ).toBe(queuedNext);
    expect(
      getAuthoritativeNextPlaybackCandidate({
        currentAssetId: "asset-server-changed",
        activeAssetId: "asset-archived-local",
        nextAsset: queuedNext,
        localRotationAuthoritativeAssetId: "asset-server-current"
      })
    ).toBeNull();
  });

  it("commits an authoritative next that is already visible through local rotation", () => {
    const input = {
      currentAssetId: "asset-server-current",
      activeAssetId: "asset-fresh-next",
      nextAssetId: "asset-fresh-next",
      localRotationAuthoritativeAssetId: "asset-server-current",
      playbackMutationsEnabled: true
    };

    expect(shouldCommitVisibleAuthoritativeNext(input)).toBe(true);
    expect(
      shouldCommitVisibleAuthoritativeNext({
        ...input,
        playbackMutationsEnabled: false
      })
    ).toBe(false);
    expect(
      shouldCommitVisibleAuthoritativeNext({
        ...input,
        nextAssetId: "asset-other-next"
      })
    ).toBe(false);
  });

  it("keeps the current clip looping when no authoritative, manual, or local candidate exists", () => {
    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: null,
        authoritativeNextAsset: null,
        localRotationAsset: null,
        isMonitor: false
      })
    ).toBeNull();
  });

  it("prioritizes authoritative and manual candidates ahead of local display rotation", () => {
    const serverCurrent = { id: "asset-server-current" };
    const manualRequest = { id: "asset-manual" };
    const queuedNext = { id: "asset-ready-next" };
    const localRotation = { id: "asset-archived-local" };

    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: serverCurrent,
        requestedAsset: manualRequest,
        authoritativeNextAsset: queuedNext,
        localRotationAsset: localRotation,
        isMonitor: true
      })
    ).toEqual({
      asset: serverCurrent,
      source: "authoritative-current"
    });
    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: manualRequest,
        authoritativeNextAsset: queuedNext,
        localRotationAsset: localRotation,
        isMonitor: false
      })
    ).toEqual({
      asset: manualRequest,
      source: "manual-request"
    });
    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: null,
        authoritativeNextAsset: queuedNext,
        localRotationAsset: localRotation,
        isMonitor: false
      })
    ).toEqual({
      asset: queuedNext,
      source: "authoritative-next"
    });
  });

  it("lets a read-only monitor rotate locally while ignoring uncommitted controls", () => {
    const localRotation = { id: "asset-archived-local" };

    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: { id: "asset-manual" },
        authoritativeNextAsset: { id: "asset-ready-next" },
        localRotationAsset: localRotation,
        isMonitor: true
      })
    ).toEqual({
      asset: localRotation,
      source: "local-rotation"
    });
  });

  it("holds every prepared candidate until a committed asset becomes server-current", () => {
    const localRotation = { id: "asset-local-next" };

    expect(
      shouldHoldPlaybackForAuthoritativeCommit({
        awaitingAssetId: "asset-committed",
        baselineCurrentAssetId: "asset-old-current",
        currentAssetId: "asset-old-current",
        playbackMutationsEnabled: true
      })
    ).toBe(true);
    expect(
      shouldHoldPlaybackForAuthoritativeCommit({
        awaitingAssetId: "asset-committed",
        baselineCurrentAssetId: "asset-old-current",
        currentAssetId: "asset-committed",
        playbackMutationsEnabled: true
      })
    ).toBe(false);
    expect(
      shouldHoldPlaybackForAuthoritativeCommit({
        awaitingAssetId: "asset-committed",
        baselineCurrentAssetId: "asset-old-current",
        currentAssetId: "asset-old-current",
        playbackMutationsEnabled: false
      })
    ).toBe(false);
    expect(
      shouldHoldPlaybackForAuthoritativeCommit({
        awaitingAssetId: "asset-committed",
        baselineCurrentAssetId: "asset-old-current",
        currentAssetId: "asset-unrelated-authoritative-change",
        playbackMutationsEnabled: true
      })
    ).toBe(false);
    expect(
      shouldHoldPlaybackForAuthoritativeCommit({
        awaitingAssetId: "asset-committed-from-empty-playback",
        baselineCurrentAssetId: null,
        currentAssetId: undefined,
        playbackMutationsEnabled: true
      })
    ).toBe(true);

    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: { id: "asset-stale-server-current" },
        requestedAsset: { id: "asset-new-manual" },
        authoritativeNextAsset: { id: "asset-new-ready" },
        localRotationAsset: localRotation,
        isMonitor: false,
        holdForAuthoritativeCommit: true
      })
    ).toBeNull();

    // Monitor mode never creates an authoritative commit hold, so its local
    // playlist remains independent and read-only.
    expect(
      getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: null,
        authoritativeNextAsset: null,
        localRotationAsset: localRotation,
        isMonitor: true,
        holdForAuthoritativeCommit: false
      })
    ).toEqual({
      asset: localRotation,
      source: "local-rotation"
    });
  });

  it("acknowledges a manual take of the active clip so it cannot replay later", () => {
    const requestId = "manual-take-1";

    expect(
      decideManualTakeRequest({
        requestId,
        handledRequestId: null,
        selectedAssetId: "asset-active",
        activeAssetId: "asset-active"
      })
    ).toBe("acknowledge-active");
    expect(
      decideManualTakeRequest({
        requestId,
        handledRequestId: requestId,
        selectedAssetId: "asset-active",
        activeAssetId: "asset-rotated-later"
      })
    ).toBe("ignore");
  });

  it("commits only explicit manual and authoritative-next handoffs", () => {
    expect(
      shouldCommitShowPlaybackTransition({
        source: "local-rotation",
        playbackMutationsEnabled: true
      })
    ).toBe(false);
    expect(
      shouldCommitShowPlaybackTransition({
        source: "authoritative-current",
        playbackMutationsEnabled: true
      })
    ).toBe(false);
    expect(
      shouldCommitShowPlaybackTransition({
        source: "manual-request",
        playbackMutationsEnabled: true
      })
    ).toBe(true);
    expect(
      shouldCommitShowPlaybackTransition({
        source: "authoritative-next",
        playbackMutationsEnabled: true
      })
    ).toBe(true);
    expect(
      shouldCommitShowPlaybackTransition({
        source: "authoritative-next",
        playbackMutationsEnabled: false
      })
    ).toBe(false);
  });

  it.each([
    {
      duration: 4,
      beforeLeadTime: 3.49,
      atLeadTime: 3.5
    },
    {
      duration: 6,
      beforeLeadTime: 5.49,
      atLeadTime: 5.5
    },
    {
      duration: 8,
      beforeLeadTime: 7.49,
      atLeadTime: 7.5
    }
  ])(
    "begins the automatic transition within the final half-second of a $duration-second video",
    ({ duration, beforeLeadTime, atLeadTime }) => {
      const baseInput = {
        isMonitor: false,
        activeSlot: true,
        audioSyncConnected: false,
        nextAssetReady: true,
        transitionInFlight: false,
        duration
      };

      expect(
        shouldStartAutomaticPlaybackTransition({
          ...baseInput,
          currentTime: beforeLeadTime
        })
      ).toBe(false);
      expect(
        shouldStartAutomaticPlaybackTransition({
          ...baseInput,
          currentTime: atLeadTime
        })
      ).toBe(true);
    }
  );

  it("gates automatic near-end transitions on playback state", () => {
    const baseInput = {
      isMonitor: false,
      activeSlot: true,
      audioSyncConnected: false,
      nextAssetReady: true,
      transitionInFlight: false,
      currentTime: 7.75,
      duration: 8
    };

    expect(shouldStartAutomaticPlaybackTransition(baseInput)).toBe(true);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        isMonitor: true
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        activeSlot: false
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        audioSyncConnected: true
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        nextAssetReady: false
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        transitionInFlight: true
      })
    ).toBe(false);
  });

  it.each([
    {
      currentTime: Number.NaN,
      duration: 8
    },
    {
      currentTime: 7,
      duration: Number.POSITIVE_INFINITY
    },
    {
      currentTime: 0,
      duration: 0
    },
    {
      currentTime: -0.1,
      duration: 8
    },
    {
      currentTime: 8.1,
      duration: 8
    }
  ])(
    "rejects invalid media timing %#",
    ({ currentTime, duration }) => {
      expect(
        shouldStartAutomaticPlaybackTransition({
          isMonitor: false,
          activeSlot: true,
          audioSyncConnected: false,
          nextAssetReady: true,
          transitionInFlight: false,
          currentTime,
          duration
        })
      ).toBe(false);
    }
  );

  it("keeps a decoded video slot visible across the logical handoff", () => {
    const incomingSlot = getStandbyVideoSlot(0);

    expect(incomingSlot).toBe(1);
    expect(
      [0, 1].map((slot) =>
        isVideoSlotVisible({
          slot: slot as 0 | 1,
          activeSlot: 0,
          incomingSlot
        })
      )
    ).toEqual([true, true]);
    expect(
      [0, 1].map((slot) =>
        isVideoSlotVisible({
          slot: slot as 0 | 1,
          activeSlot: incomingSlot,
          incomingSlot: null
        })
      )
    ).toEqual([false, true]);
  });

  it("hydrates a first video that becomes current after the show has opened", () => {
    const firstVideo = {
      assetId: "seed-1"
    };

    expect(getRenderableVideoSlots([null, null], 0, firstVideo)).toEqual([
      firstVideo,
      null
    ]);
    expect(getRenderableVideoSlots([null, null], 1, firstVideo)).toEqual([
      null,
      firstVideo
    ]);
  });

  it("does not overwrite an active video while snapshots update", () => {
    const activeVideo = {
      assetId: "active-1"
    };
    const serverCurrentVideo = {
      assetId: "server-current"
    };
    const slots: [
      typeof activeVideo | null,
      typeof activeVideo | null
    ] = [activeVideo, null];

    expect(getRenderableVideoSlots(slots, 0, serverCurrentVideo)).toBe(slots);
  });

  it("advances the rotation only when the active video ends with a next clip ready", () => {
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(true);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: false,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(false);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: true,
        nextAssetReady: true
      })
    ).toBe(false);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: false
      })
    ).toBe(false);
  });

  it("keeps audio-synced handoffs at boundaries while requiring cue authorization", () => {
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: false,
        candidateAssetId: "remix-2",
        authorizedAssetId: null
      })
    ).toBe(true);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: true,
        candidateAssetId: "remix-2",
        authorizedAssetId: null
      })
    ).toBe(false);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: true,
        candidateAssetId: "remix-2",
        authorizedAssetId: "remix-2"
      })
    ).toBe(true);
  });

  it("does not make local display rotation wait for an authoritative audio cue", () => {
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        localRotation: true,
        audioSyncConnected: true,
        candidateAssetId: "archived-local",
        authorizedAssetId: null
      })
    ).toBe(true);
  });

  it("allows a read-only monitor to follow only its authoritative candidate", () => {
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: true,
        audioSyncConnected: true,
        candidateAssetId: "server-current",
        authorizedAssetId: null
      })
    ).toBe(true);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: true,
        audioSyncConnected: false,
        candidateAssetId: null,
        authorizedAssetId: null
      })
    ).toBe(false);
  });
});
