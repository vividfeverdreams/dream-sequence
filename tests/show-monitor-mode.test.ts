import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionSnapshot: vi.fn()
}));

vi.mock("@/lib/snapshot", () => ({
  getSessionSnapshot: mocks.getSessionSnapshot
}));

vi.mock("@/components/show-screen", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/show-screen")>();

  return {
    ...actual,
    ShowScreen: () => null
  };
});

import ShowPage from "@/app/show/[sessionId]/page";
import {
  canMutateShowPlayback,
  shouldAdvanceShowPlaybackAtVideoEnd
} from "@/components/show-screen";

vi.stubGlobal("React", React);

describe("show monitor mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("awaits search params and passes monitor mode into the show screen", async () => {
    const snapshot = {
      session: {
        id: "session-1"
      }
    };
    mocks.getSessionSnapshot.mockResolvedValue(snapshot);

    const result = await ShowPage({
      params: Promise.resolve({
        sessionId: "session-1"
      }),
      searchParams: Promise.resolve({
        monitor: "1"
      })
    });

    expect(mocks.getSessionSnapshot).toHaveBeenCalledWith("session-1");
    expect(result.props).toMatchObject({
      initialSnapshot: snapshot,
      isMonitor: true
    });
  });

  it("recognizes monitor=1 among repeated query values", async () => {
    const snapshot = {
      session: {
        id: "session-1"
      }
    };
    mocks.getSessionSnapshot.mockResolvedValue(snapshot);

    const result = await ShowPage({
      params: Promise.resolve({
        sessionId: "session-1"
      }),
      searchParams: Promise.resolve({
        monitor: ["0", "1"]
      })
    });

    expect(result.props.isMonitor).toBe(true);
  });

  it("keeps ordinary show pages mutation-enabled", async () => {
    const snapshot = {
      session: {
        id: "session-1"
      }
    };
    mocks.getSessionSnapshot.mockResolvedValue(snapshot);

    const result = await ShowPage({
      params: Promise.resolve({
        sessionId: "session-1"
      }),
      searchParams: Promise.resolve({})
    });

    expect(result.props.isMonitor).toBe(false);
    expect(canMutateShowPlayback(false)).toBe(true);
  });

  it("advances a ready story scene at clip end even while audio effects are connected", () => {
    expect(shouldAdvanceShowPlaybackAtVideoEnd({
      isMonitor: false,
      activeSlotEnded: true,
      audioSyncConnected: true,
      nextAssetReady: true
    })).toBe(true);
    expect(shouldAdvanceShowPlaybackAtVideoEnd({
      isMonitor: false,
      activeSlotEnded: true,
      audioSyncConnected: true,
      nextAssetReady: false
    })).toBe(false);
  });

  it("keeps monitor playback read-only without blocking local media advances", () => {
    expect(canMutateShowPlayback(true)).toBe(false);
    expect(
      shouldAdvanceShowPlaybackAtVideoEnd({
        isMonitor: true,
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(true);
    expect(
      shouldAdvanceShowPlaybackAtVideoEnd({
        isMonitor: false,
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(true);
  });
});
