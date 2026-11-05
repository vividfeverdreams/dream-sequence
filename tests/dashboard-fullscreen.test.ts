import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardShell,
  getDashboardShowFrameSource,
  isDashboardShowFullscreen,
  requestDashboardShowFullscreen,
  syncDashboardShowPlaybackMode
} from "@/components/dashboard-shell";
import { ShowScreen } from "@/components/show-screen";
import {
  createShowPlaybackModeMessage,
  readShowPlaybackModeMessage,
  showPlaybackModeMessageType
} from "@/lib/show-playback-mode";
import type { SessionSnapshot } from "@/lib/snapshot";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function createSnapshot() {
  const currentAsset = {
    id: "asset-current",
    kind: "seed",
    title: "Current loop",
    promptText: "A live visual",
    publicUrl: "/current-loop.mp4",
    status: "live",
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    sourceSubmission: null
  };

  return {
    session: {
      id: "session-1",
      userId: "user-1",
      playbackState: {
        currentAsset,
        nextAsset: null,
        fallbackAsset: null,
        crossfadeSeconds: 2
      },
      visualAssets: [currentAsset],
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
      readyAssetCount: 0,
      waitingOnRender: false
    }
  } as unknown as NonNullable<SessionSnapshot>;
}

describe("dashboard fullscreen show", () => {
  it("labels automatic prompts and previous generations as Dream Sequence continuations", () => {
    const snapshot = createSnapshot();
    const continuation = {
      id: "submission-automatic",
      source: "automatic",
      sender: null,
      rawText: "The glowing door opens onto a sea of stars.",
      referenceImageUrl: null,
      status: "ready",
      approvalReason: "Automatic continuation",
      createdAt: new Date("2026-09-16T12:00:00.000Z"),
      rankingResult: null
    };
    Object.assign(snapshot.session, {
      name: "A door among the stars",
      status: "live",
      basePrompt: "A fox finds a glowing door.",
      videoResolution: "768P",
      videoDurationSeconds: 5,
      submissions: [continuation]
    });
    snapshot.session.visualAssets.push({
      id: "asset-automatic",
      kind: "remix",
      title: "The story continues",
      promptText: "Private generation prompt",
      publicUrl: "/automatic.mp4",
      status: "archived",
      createdAt: continuation.createdAt,
      sourceSubmission: continuation
    });

    const markup = renderToStaticMarkup(React.createElement(DashboardShell, {
      initialSnapshot: snapshot,
      currentUserName: "Story host",
      initialOpenAiStatus: { configured: false, source: "none", last4: null },
      initialGoogleStatus: { configured: false, provider: "fal", source: "none", last4: null },
      audioSyncRelayToken: ""
    }));

    expect(markup).toContain("Dream Sequence continuation");
    expect(markup).toMatch(/<span[^>]*>Dream Sequence<\/span>/);
    expect(markup).toContain(continuation.rawText);
    expect(markup).not.toContain(">User prompt<");
    expect(markup).not.toContain(">automatic<");
  });

  it.each([false, true])(
    "does not render a fullscreen prompt when monitor mode is %s",
    (isMonitor) => {
      const markup = renderToStaticMarkup(
        React.createElement(ShowScreen, {
          initialSnapshot: createSnapshot(),
          isMonitor
        })
      ).toLowerCase();

      expect(markup).not.toContain("presentation mode");
      expect(markup).not.toContain("enter fullscreen");
    }
  );

  it("keeps the show iframe mounted at one stable source across fullscreen changes", () => {
    const inlineSource = getDashboardShowFrameSource(
      "/show/session-1",
      false
    );
    const fullscreenSource = getDashboardShowFrameSource(
      "/show/session-1",
      true
    );

    expect(inlineSource).toBe("/show/session-1?monitor=1");
    expect(fullscreenSource).toBe(inlineSource);
  });

  it("syncs read-only monitor mode inline and owner playback mode in fullscreen", () => {
    const postMessage = vi.fn();
    const frameWindow = { postMessage };
    const targetOrigin = "https://dream-sequence.example";

    syncDashboardShowPlaybackMode(frameWindow, false, targetOrigin);
    syncDashboardShowPlaybackMode(frameWindow, true, targetOrigin);

    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      createShowPlaybackModeMessage(true),
      targetOrigin
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      createShowPlaybackModeMessage(false),
      targetOrigin
    );
  });

  it("does not throw when the stable show iframe is not loaded yet", () => {
    expect(() =>
      syncDashboardShowPlaybackMode(null, true, "https://dream-sequence.example")
    ).not.toThrow();
  });

  it.each([true, false])(
    "round-trips monitor=%s through the show playback mode message",
    (monitor) => {
      const message = createShowPlaybackModeMessage(monitor);

      expect(message).toEqual({
        type: showPlaybackModeMessageType,
        monitor
      });
      expect(readShowPlaybackModeMessage(message)).toBe(monitor);
    }
  );

  it.each([
    null,
    undefined,
    false,
    "dream-sequence:show-playback-mode",
    [],
    {},
    { type: "other-message", monitor: true },
    { type: showPlaybackModeMessageType },
    { type: showPlaybackModeMessageType, monitor: "false" }
  ])("rejects malformed show playback mode message %#", (message) => {
    expect(readShowPlaybackModeMessage(message)).toBeNull();
  });

  it("recognizes only the dashboard show surface as fullscreen", () => {
    const surface = {} as HTMLElement;
    const otherElement = {} as Element;

    expect(isDashboardShowFullscreen(surface, surface)).toBe(true);
    expect(isDashboardShowFullscreen(otherElement, surface)).toBe(false);
    expect(isDashboardShowFullscreen(null, null)).toBe(false);
  });

  it("requests fullscreen on the stable dashboard show surface", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const surface = { requestFullscreen } as unknown as HTMLElement;

    await requestDashboardShowFullscreen(surface);

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).toHaveBeenCalledWith();
  });

  it("reports browsers that do not support fullscreen", async () => {
    await expect(requestDashboardShowFullscreen(null)).rejects.toThrow(
      "Fullscreen is not supported in this browser."
    );
  });
});
