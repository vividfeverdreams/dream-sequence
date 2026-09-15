import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowScreen } from "@/components/show-screen";
import * as playback from "@/lib/remix-transition";
import type { SessionSnapshot } from "@/lib/snapshot";

vi.stubGlobal("React", React);

function createSnapshot(currentIndex: number, assetCount: number, nextIndex?: number) {
  const assets = Array.from({ length: assetCount }, (_, index) => ({
    id: `clip-${index}`,
    kind: index === 0 ? "seed" : "remix",
    title: `Clip ${index}`,
    promptText: `Story scene ${index}`,
    publicUrl: `/clip-${index}.mp4`,
    status: index === currentIndex ? "live" : index === nextIndex ? "ready" : "archived",
    createdAt: new Date(Date.UTC(2026, 8, 13, 12, index)),
    sourceSubmission: null
  }));

  return {
    session: {
      id: "session-rotation",
      userId: "user-1",
      playbackState: {
        currentAsset: assets[currentIndex],
        nextAsset: nextIndex === undefined ? null : assets[nextIndex],
        fallbackAsset: null,
        crossfadeSeconds: 2
      },
      visualAssets: assets.slice().reverse(),
      renderJobs: [],
      wordmarkAudioReactiveOnly: false,
      wordmarkOverlayVisible: false,
      wordmarkOpacity: 1,
      wordmarkSize: 1,
      progressOverlayVisible: false,
      qrOverlayVisible: false
    },
    queueHealth: {
      approvedCount: 0,
      queuedRenderCount: 0,
      renderingCount: 0,
      readyAssetCount: nextIndex === undefined ? 0 : 1,
      waitingOnRender: false
    }
  } as unknown as NonNullable<SessionSnapshot>;
}

describe("show screen three-video loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([false, true])("prepares every successor and wraps within the latest three clips (monitor=%s)", (isMonitor) => {
    const candidate = vi.spyOn(playback, "getShowPlaybackCandidate");

    // Include older clips to verify that they leave the rolling three-clip window.
    for (const [currentIndex, expectedNextIndex] of [
      [2, 5], [3, 5], [4, 5], [5, 6], [6, 7], [7, 5]
    ]) {
      renderToStaticMarkup(React.createElement(ShowScreen, {
        initialSnapshot: createSnapshot(currentIndex, 8),
        isMonitor
      }));

      expect(candidate.mock.results.at(-1)?.value).toMatchObject({
        asset: { id: `clip-${expectedNextIndex}` },
        source: "local-rotation"
      });
    }
  });

  it("gives a newly queued clip priority over the next clip in the loop", () => {
    const candidate = vi.spyOn(playback, "getShowPlaybackCandidate");

    renderToStaticMarkup(React.createElement(ShowScreen, {
      initialSnapshot: createSnapshot(4, 9, 8)
    }));

    expect(candidate.mock.results.at(-1)?.value).toMatchObject({
      asset: { id: "clip-8" },
      source: "authoritative-next"
    });
  });

  it.each([false, true])("keeps a single available clip playing without queuing itself (monitor=%s)", (isMonitor) => {
    const candidate = vi.spyOn(playback, "getShowPlaybackCandidate");
    const markup = renderToStaticMarkup(React.createElement(ShowScreen, {
      initialSnapshot: createSnapshot(0, 1),
      isMonitor
    }));

    expect(markup).toContain('src="/clip-0.mp4"');
    expect(candidate.mock.results.at(-1)?.value).toBeNull();
  });
});
