"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { DashboardAudioSync } from "@/components/dashboard-audio-sync";
import { DashboardDisclosure } from "@/components/dashboard-disclosure";
import type { OpenAiConnectionStatus } from "@/lib/openai-key-store";
import type { GoogleConnectionStatus } from "@/lib/google-key-store";
import { getAccountRemixPath } from "@/lib/remix-links";
import { normalizeVideoProgress } from "@/lib/render-progress";
import { createShowPlaybackModeMessage } from "@/lib/show-playback-mode";
import type { SessionSnapshot } from "@/lib/snapshot";
import { useSessionSnapshot } from "@/lib/use-session-snapshot";
import { formatRelativeTime } from "@/lib/utils";
import {
  getVideoModelDefinition,
  normalizeVideoModelId
} from "@/lib/video-models";
import { getVideoModerationDiagnosticLabel } from "@/lib/video-moderation";

type DashboardShellProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  currentUserName: string;
  initialOpenAiStatus: OpenAiConnectionStatus;
  initialGoogleStatus: GoogleConnectionStatus;
  audioSyncRelayToken: string;
};

type InitialGenerationJob = {
  status: string;
  failureReason: string | null;
  canRecover?: boolean;
};

export function getInitialGenerationPresentation(input: {
  sessionStatus: string;
  hasCurrentAsset: boolean;
  isStarting: boolean;
  seedJob?: InitialGenerationJob;
}) {
  if (input.hasCurrentAsset || (!input.isStarting && input.sessionStatus !== "live")) {
    return {
      visible: false,
      failed: false,
      failureReason: null
    };
  }

  if (input.isStarting) {
    return {
      visible: true,
      failed: false,
      failureReason: null
    };
  }

  if (input.seedJob?.status === "queued" || input.seedJob?.status === "in_progress") {
    return {
      visible: true,
      failed: false,
      failureReason: null
    };
  }

  if (input.seedJob?.status === "failed") {
    return {
      visible: true,
      failed: true,
      failureReason:
        input.seedJob.failureReason ||
        "The video renderer could not finish the first video. Retry the generation."
    };
  }

  return {
    visible: true,
    failed: true,
    failureReason:
      input.seedJob?.status === "completed"
        ? "The first video finished, but it did not enter live playback. Retry the generation."
        : "The first video job could not be created. Retry the generation."
  };
}

export function shouldReconcileSession({
  sessionStatus,
  waitingOnRender,
  approvedCount,
  hasReadyAsset
}: {
  sessionStatus: string;
  waitingOnRender: boolean;
  approvedCount: number;
  hasReadyAsset: boolean;
}) {
  return (
    sessionStatus === "live" &&
    (waitingOnRender || approvedCount > 0 || hasReadyAsset)
  );
}

export function getDashboardShowFrameSource(
  showLink: string,
  _fullscreenActive: boolean
) {
  return `${showLink}?monitor=1`;
}

export function syncDashboardShowPlaybackMode(
  frameWindow: Pick<Window, "postMessage"> | null | undefined,
  fullscreenActive: boolean,
  targetOrigin: string
) {
  frameWindow?.postMessage(
    createShowPlaybackModeMessage(!fullscreenActive),
    targetOrigin
  );
}

export function isDashboardShowFullscreen(
  fullscreenElement: Element | null,
  showSurface: HTMLElement | null
) {
  return fullscreenElement !== null && fullscreenElement === showSurface;
}

export async function requestDashboardShowFullscreen(
  target: HTMLElement | null
) {
  if (!target?.requestFullscreen) {
    throw new Error("Fullscreen is not supported in this browser.");
  }

  await target.requestFullscreen();
}

export function DashboardShell({
  initialSnapshot,
  currentUserName,
  initialOpenAiStatus,
  initialGoogleStatus,
  audioSyncRelayToken
}: DashboardShellProps) {
  const snapshot = useSessionSnapshot(initialSnapshot);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);
  const [showWindowFeedback, setShowWindowFeedback] = useState<string | null>(null);
  const [showUrlDisplay, setShowUrlDisplay] = useState("");
  const [fullscreenShowActive, setFullscreenShowActive] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [renderProgress, setRenderProgress] = useState<Record<string, number>>({});
  const [pendingQrOverlayVisibility, setPendingQrOverlayVisibility] = useState<boolean | null>(null);
  const [pendingWordmarkOverlayVisibility, setPendingWordmarkOverlayVisibility] = useState<boolean | null>(
    null
  );
  const [pendingWordmarkOpacity, setPendingWordmarkOpacity] = useState<number | null>(null);
  const [pendingWordmarkSize, setPendingWordmarkSize] = useState<number | null>(null);
  const [pendingWordmarkAudioReactiveOnly, setPendingWordmarkAudioReactiveOnly] = useState<
    boolean | null
  >(null);
  const [pendingProgressOverlayVisibility, setPendingProgressOverlayVisibility] = useState<
    boolean | null
  >(null);
  const generationMenuRef = useRef<HTMLDetailsElement>(null);
  const fullscreenShowSurfaceRef = useRef<HTMLDivElement>(null);
  const liveMonitorRef = useRef<HTMLIFrameElement>(null);
  const reconciliationInFlightRef = useRef(false);
  const submittedWordmarkOpacityRef = useRef(initialSnapshot.session.wordmarkOpacity);
  const submittedWordmarkSizeRef = useRef(initialSnapshot.session.wordmarkSize);
  const deferredSnapshot = useDeferredValue(snapshot);
  const openAiStatus = initialOpenAiStatus;
  const googleStatus = initialGoogleStatus;

  const session = deferredSnapshot.session;
  const videoModel = getVideoModelDefinition(
    normalizeVideoModelId(session.videoModel)
  );
  const qrOverlayVisible = pendingQrOverlayVisibility ?? session.qrOverlayVisible;
  const wordmarkOverlayVisible =
    pendingWordmarkOverlayVisibility ?? session.wordmarkOverlayVisible;
  const wordmarkOpacity = pendingWordmarkOpacity ?? session.wordmarkOpacity;
  const wordmarkSize = pendingWordmarkSize ?? session.wordmarkSize;
  const wordmarkAudioReactiveOnly =
    pendingWordmarkAudioReactiveOnly ?? session.wordmarkAudioReactiveOnly;
  const progressOverlayVisible =
    pendingProgressOverlayVisibility ?? session.progressOverlayVisible;
  const playback = session.playbackState;
  const twitchMode = session.audienceMode === "twitch";
  const publicLink = twitchMode && session.twitchChannel
    ? `https://www.twitch.tv/${encodeURIComponent(session.twitchChannel)}`
    : getAccountRemixPath(session.userId);
  const showLink = `/show/${session.id}`;
  const seedRender = session.renderJobs.find((job: any) => job.mode === "seed");
  const isStartingInitialRender = workingAction === "start-session";
  const initialGenerationPresentation = getInitialGenerationPresentation({
    sessionStatus: session.status,
    hasCurrentAsset: Boolean(playback?.currentAsset),
    isStarting: isStartingInitialRender,
    seedJob: seedRender
  });
  const canStartSession =
    session.status !== "live" || initialGenerationPresentation.failed;
  const previousGenerations = session.visualAssets.filter(
    (asset) => asset.id !== playback?.currentAsset?.id
  );
  const activeRenderJob = session.renderJobs.find(
    (job: any) => job.status === "queued" || job.status === "in_progress"
  );
  const activeRenderProgress = activeRenderJob
    ? renderProgress[activeRenderJob.id] ?? activeRenderJob.progress ?? undefined
    : undefined;
  const enabledOverlayCount = [
    qrOverlayVisible,
    wordmarkOverlayVisible,
    progressOverlayVisible
  ].filter(Boolean).length;
  const renderJobsStatus = activeRenderJob
    ? activeRenderProgress === undefined
      ? activeRenderJob.status.replace("_", " ")
      : `~${activeRenderProgress}% estimated`
    : `${session.renderJobs.length} recent`;
  const reconciliationNeeded = shouldReconcileSession({
    sessionStatus: session.status,
    waitingOnRender: deferredSnapshot.queueHealth.waitingOnRender,
    approvedCount: deferredSnapshot.queueHealth.approvedCount,
    hasReadyAsset: session.visualAssets.some(
      (asset) => asset.status === "ready" && Boolean(asset.publicUrl)
    )
  });

  useEffect(() => {
    if (!reconciliationNeeded) {
      return;
    }

    const reconcile = async () => {
      if (reconciliationInFlightRef.current) {
        return;
      }

      reconciliationInFlightRef.current = true;

      try {
        const response = await fetch(`/api/sessions/${session.id}/reconcile`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${audioSyncRelayToken}`
          }
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          jobs?: Array<{
            id: string;
            progress: number | null;
          }>;
        };

        if (!payload.jobs?.length) {
          return;
        }

        setRenderProgress((current) => {
          const next = { ...current };

          for (const job of payload.jobs ?? []) {
            if (typeof job.progress === "number") {
              next[job.id] = normalizeVideoProgress(job.progress, current[job.id]);
            }
          }

          return next;
        });
      } catch {
        // A later interval retries transient network failures.
      } finally {
        reconciliationInFlightRef.current = false;
      }
    };

    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    audioSyncRelayToken,
    reconciliationNeeded,
    session.id
  ]);

  useEffect(() => {
    setShowUrlDisplay(resolveAbsoluteUrl(showLink));
  }, [showLink]);

  useEffect(() => {
    const syncFullscreenShowState = () => {
      setFullscreenShowActive(
        isDashboardShowFullscreen(
          document.fullscreenElement,
          fullscreenShowSurfaceRef.current
        )
      );
    };

    syncFullscreenShowState();
    document.addEventListener("fullscreenchange", syncFullscreenShowState);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenShowState);
    };
  }, []);

  useEffect(() => {
    syncDashboardShowPlaybackMode(
      liveMonitorRef.current?.contentWindow,
      fullscreenShowActive,
      window.location.origin
    );
  }, [fullscreenShowActive]);

  useEffect(() => {
    if (pendingQrOverlayVisibility === session.qrOverlayVisible) {
      setPendingQrOverlayVisibility(null);
    }
  }, [pendingQrOverlayVisibility, session.qrOverlayVisible]);

  useEffect(() => {
    if (pendingWordmarkOverlayVisibility === session.wordmarkOverlayVisible) {
      setPendingWordmarkOverlayVisibility(null);
    }
  }, [pendingWordmarkOverlayVisibility, session.wordmarkOverlayVisible]);

  useEffect(() => {
    if (pendingWordmarkOpacity === session.wordmarkOpacity) {
      submittedWordmarkOpacityRef.current = session.wordmarkOpacity;
      setPendingWordmarkOpacity(null);
    } else if (pendingWordmarkOpacity === null) {
      submittedWordmarkOpacityRef.current = session.wordmarkOpacity;
    }
  }, [pendingWordmarkOpacity, session.wordmarkOpacity]);

  useEffect(() => {
    if (pendingWordmarkSize === session.wordmarkSize) {
      submittedWordmarkSizeRef.current = session.wordmarkSize;
      setPendingWordmarkSize(null);
    } else if (pendingWordmarkSize === null) {
      submittedWordmarkSizeRef.current = session.wordmarkSize;
    }
  }, [pendingWordmarkSize, session.wordmarkSize]);

  useEffect(() => {
    if (pendingWordmarkAudioReactiveOnly === session.wordmarkAudioReactiveOnly) {
      setPendingWordmarkAudioReactiveOnly(null);
    }
  }, [pendingWordmarkAudioReactiveOnly, session.wordmarkAudioReactiveOnly]);

  useEffect(() => {
    if (pendingProgressOverlayVisibility === session.progressOverlayVisible) {
      setPendingProgressOverlayVisibility(null);
    }
  }, [pendingProgressOverlayVisibility, session.progressOverlayVisible]);

  useEffect(() => {
    if (!confirmingClear) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setConfirmingClear(false);
    }, 6000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [confirmingClear]);

  async function clearAndStartNewSession() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      setControlFeedback(
        "Clearing deletes this session, its crowd queue, and its render history. Click the button again to confirm."
      );
      return;
    }

    setConfirmingClear(false);
    setControlFeedback(null);
    setWorkingAction("clear-session");

    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Could not clear the current session.");
      }

      window.location.href = "/dashboard/new";
    } catch (error) {
      setControlFeedback(describeDashboardRequestError(error, "Clearing the session"));
      setWorkingAction(null);
    }
  }

  async function runControlAction(action: string, value?: boolean | number, assetId?: string) {
    if (action === "skip-next" && !snapshot.session.playbackState?.nextAsset) {
      setControlFeedback(
        snapshot.queueHealth.waitingOnRender
          ? "Skip To Next is waiting on a ready loop. A remix is still rendering right now."
          : "Skip To Next only works when a ready next loop is loaded."
      );
      return false;
    }

    setControlFeedback(null);
    setWorkingAction(action === "cue-generation" && assetId ? `${action}:${assetId}` : action);

    try {
      if (action === "start-session") {
        const response = await fetch(`/api/sessions/${session.id}/start`, {
          method: "POST"
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Could not start the session.");
        }
      } else if (action === "logout") {
        const response = await fetch("/api/auth/logout", {
          method: "POST"
        });

        if (!response.ok) {
          throw new Error("Could not log out right now.");
        }

        window.location.href = "/login";
        return true;
      } else {
        const response = await fetch(`/api/sessions/${session.id}/control`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            value,
            assetId
          })
        });

        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Could not run that control action.");
        }
      }

      if (action === "skip-next") {
        setControlFeedback("Switched the live output to the queued remix.");
      } else if (action === "fallback-remix") {
        setControlFeedback("Fallback remix queued. The show stays on the current loop until the new render is ready.");
      } else if (action === "cue-generation") {
        setControlFeedback("Previous generation cued. Showing its original user prompt and crossfading it into the live output now.");
      } else if (action === "pause-selection") {
        setControlFeedback("Automated crowd selection is paused.");
      } else if (action === "resume-selection") {
        setControlFeedback("Automated crowd selection resumed.");
      } else if (action === "stop-session") {
        setControlFeedback("Session stopped. Audience intake is offline until you restart it.");
      } else if (action === "set-qr-overlay") {
        const overlayName = twitchMode ? "Twitch chat instructions" : "Audience QR";
        setControlFeedback(value ? `${overlayName} now shown on the live output.` : `${overlayName} now hidden.`);
      } else if (action === "set-wordmark-overlay") {
        setControlFeedback(value ? "Wordmark is now centered on the live output." : "Wordmark is now hidden.");
      } else if (action === "set-wordmark-opacity") {
        setControlFeedback(`Wordmark opacity saved at ${Math.round(Number(value) * 100)}%.`);
      } else if (action === "set-wordmark-size") {
        setControlFeedback(`Wordmark size saved at ${Math.round(Number(value) * 100)}%.`);
      } else if (action === "set-wordmark-audio-reactive-only") {
        setControlFeedback(
          value
            ? "Audio-reactive VFX now affect only the wordmark layer."
            : "Audio-reactive VFX now affect the generated visuals."
        );
      } else if (action === "set-progress-overlay") {
        setControlFeedback(
          value
            ? "Next-remix progress is now visible on the live output."
            : "Next-remix progress is now hidden."
        );
      }

      return true;
    } catch (error) {
      setControlFeedback(describeDashboardRequestError(error, "That dashboard action"));
      return false;
    } finally {
      setWorkingAction(null);
    }
  }

  async function updateQrOverlayVisibility(visible: boolean) {
    setPendingQrOverlayVisibility(visible);

    const succeeded = await runControlAction("set-qr-overlay", visible);

    if (!succeeded) {
      setPendingQrOverlayVisibility(null);
    }
  }

  async function updateWordmarkOverlayVisibility(visible: boolean) {
    setPendingWordmarkOverlayVisibility(visible);

    const succeeded = await runControlAction("set-wordmark-overlay", visible);

    if (!succeeded) {
      setPendingWordmarkOverlayVisibility(null);
    }
  }

  async function commitWordmarkOpacity(opacity: number) {
    const normalizedOpacity = Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100;

    if (normalizedOpacity === submittedWordmarkOpacityRef.current) {
      return;
    }

    submittedWordmarkOpacityRef.current = normalizedOpacity;
    setPendingWordmarkOpacity(normalizedOpacity);

    const succeeded = await runControlAction("set-wordmark-opacity", normalizedOpacity);

    if (!succeeded) {
      submittedWordmarkOpacityRef.current = session.wordmarkOpacity;
      setPendingWordmarkOpacity(null);
    }
  }

  async function commitWordmarkSize(size: number) {
    const normalizedSize = Math.round(Math.max(0.3, Math.min(1.5, size)) * 100) / 100;

    if (normalizedSize === submittedWordmarkSizeRef.current) {
      return;
    }

    submittedWordmarkSizeRef.current = normalizedSize;
    setPendingWordmarkSize(normalizedSize);

    const succeeded = await runControlAction("set-wordmark-size", normalizedSize);

    if (!succeeded) {
      submittedWordmarkSizeRef.current = session.wordmarkSize;
      setPendingWordmarkSize(null);
    }
  }

  async function updateWordmarkAudioReactiveOnly(wordmarkOnly: boolean) {
    setPendingWordmarkAudioReactiveOnly(wordmarkOnly);

    const succeeded = await runControlAction("set-wordmark-audio-reactive-only", wordmarkOnly);

    if (!succeeded) {
      setPendingWordmarkAudioReactiveOnly(null);
    }
  }

  async function updateProgressOverlayVisibility(visible: boolean) {
    setPendingProgressOverlayVisibility(visible);

    const succeeded = await runControlAction("set-progress-overlay", visible);

    if (!succeeded) {
      setPendingProgressOverlayVisibility(null);
    }
  }

  function openShowPopout() {
    const absoluteShowLink = resolveAbsoluteUrl(showLink);
    const popupFeatures = [
      "popup=yes",
      "toolbar=no",
      "location=no",
      "menubar=no",
      "status=no",
      "scrollbars=no",
      "resizable=yes",
      "left=0",
      "top=0",
      `width=${window.screen.availWidth}`,
      `height=${window.screen.availHeight}`,
    ].join(",");
    const popup = window.open(absoluteShowLink, "dream-sequence-show", popupFeatures);

    if (popup) {
      popup.moveTo(0, 0);
      popup.resizeTo(window.screen.availWidth, window.screen.availHeight);
      popup.focus();
      setShowWindowFeedback("Show window opened without dashboard controls or fullscreen prompts.");
      return;
    }

    setShowWindowFeedback(
      "The in-app browser blocked the new tab. Use Open In New Tab or Copy Show URL in the Show Links card below."
    );
  }

  async function enterFullscreenShow() {
    try {
      await requestDashboardShowFullscreen(fullscreenShowSurfaceRef.current);
      setShowWindowFeedback(
        "Fullscreen show active. Press Escape when you want to return to the dashboard."
      );
    } catch (error) {
      setShowWindowFeedback(
        error instanceof Error
          ? error.message
          : "Fullscreen was blocked by the browser."
      );
    }
  }

  async function copyShowUrl() {
    const absoluteShowLink = resolveAbsoluteUrl(showLink);

    try {
      await navigator.clipboard.writeText(absoluteShowLink);
      setShowWindowFeedback("Show URL copied. Open it in another tab/window to watch the live screen while keeping this dashboard open.");
    } catch {
      setShowWindowFeedback("Could not copy the show URL automatically. The link is shown in the Show Links card below.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">Story Dashboard</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">{session.name}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-white/70">
            {currentUserName}, your audience writes what happens next. Keep the story moving from here.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={publicLink} className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10">
            {twitchMode ? "Twitch Chat" : "Audience Form"}
          </Link>
          <button
            onClick={openShowPopout}
            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-ink transition hover:opacity-90"
          >
            Pop Out Show
          </button>
          <button
            type="button"
            onClick={() => void enterFullscreenShow()}
            className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            Fullscreen Show
          </button>
          <button
            onClick={() => void clearAndStartNewSession()}
            disabled={workingAction === "clear-session"}
            className={`rounded-full border px-5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmingClear
                ? "border-ember/60 bg-ember/15 text-ember hover:bg-ember/25"
                : "border-white/10 text-white/80 hover:bg-white/10"
            }`}
          >
            {workingAction === "clear-session"
              ? "Clearing..."
              : confirmingClear
                ? "Confirm: Delete & Start New"
                : "Clear & New Session"}
          </button>
          <button
            onClick={() => void runControlAction("logout")}
            className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            {workingAction === "logout" ? "Leaving..." : "Logout"}
          </button>
        </div>
      </header>

      {initialGenerationPresentation.visible ? (
        <InitialGenerationStatus
          job={seedRender}
          progress={
            seedRender
              ? renderProgress[seedRender.id] ?? seedRender.progress ?? undefined
              : undefined
          }
          isStarting={isStartingInitialRender}
          failed={initialGenerationPresentation.failed}
          failureReason={initialGenerationPresentation.failureReason}
        />
      ) : null}

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Session Status" value={session.status} hint={playback?.status ?? "idle"} />
        <MetricCard label="Approved Queue" value={String(deferredSnapshot.queueHealth.approvedCount)} hint="scored safe prompts" />
        <MetricCard label="Render State" value={deferredSnapshot.queueHealth.waitingOnRender ? "busy" : "clear"} hint={`${deferredSnapshot.queueHealth.renderingCount} rendering`} />
        <MetricCard label="Ready Assets" value={String(deferredSnapshot.queueHealth.readyAssetCount)} hint="live or queued visuals" />
      </section>

      {showWindowFeedback ? (
        <section className="mt-6">
          <div className="rounded-4xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-white/80">
            {showWindowFeedback}
          </div>
        </section>
      ) : null}

      {controlFeedback ? (
        <section className="mt-6">
          <div className="rounded-4xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-white/80">
            {controlFeedback}
          </div>
        </section>
      ) : null}

      {!googleStatus.configured || session.status !== "live" ? (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {session.status !== "live" ? (
            <StatusNotice
              title={session.status === "stopped" ? "Session Stopped" : "Start The Session"}
              body={
                session.status === "stopped"
                  ? "Audience intake is off right now. Restart the session to accept new requests and keep the dashboard feed moving again."
                  : "The fullscreen show view only gets a live loop after you click Start Session. Until then, the show page just sits in holding mode."
              }
            />
          ) : null}

          {!googleStatus.configured ? (
            <StatusNotice
              title="Demo Mode Active"
              body="No video generation API key is active right now, so the app is using the demo loop fallback."
            />
          ) : null}
        </section>
      ) : null}

      <section className="mt-8">
        <DashboardAudioSync
          sessionId={session.id}
          nextReady={Boolean(playback?.nextAsset?.id && playback.nextAsset.publicUrl)}
          relayToken={audioSyncRelayToken}
        />
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="panel overflow-hidden">
            <div className="grid gap-0 lg:grid-cols-[1fr_1fr]">
              <PlaybackCard
                title="Current Loop"
                assetTitle={playback?.currentAsset?.title ?? "Holding Pattern"}
                prompt={playback?.currentAsset?.promptText ?? session.basePrompt}
                status={playback?.currentAsset ? "live" : "awaiting seed"}
              />
              <PlaybackCard
                title="Next Loop"
                assetTitle={playback?.nextAsset?.title ?? "No queued remix"}
                prompt={
                  playback?.nextAsset?.promptText ??
                  "When a safe crowd render completes, it will preload here and crossfade into the show."
                }
                status={playback?.nextAsset ? "ready to fade" : "open slot"}
              />
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-white/10 px-6 py-5">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Live Monitor</p>
              <p className="mt-3 text-sm text-white/68">
                This visual-only preview mirrors the audio-reactive effects. All input, cue, and transition controls stay on this dashboard.
              </p>
            </div>

            <div
              ref={fullscreenShowSurfaceRef}
              data-dashboard-show-surface
              className="aspect-video bg-black"
            >
              <iframe
                ref={liveMonitorRef}
                src={getDashboardShowFrameSource(showLink, fullscreenShowActive)}
                title="Live show monitor"
                className="h-full w-full border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
                onLoad={() =>
                  syncDashboardShowPlaybackMode(
                    liveMonitorRef.current?.contentWindow,
                    fullscreenShowActive,
                    window.location.origin
                  )
                }
              />
            </div>
          </div>

          <DashboardDisclosure
            eyebrow="Show operation"
            title="Live Controls"
            description="Pause automation, take a ready remix, trigger a fallback, or adjust the show overlays."
            status={
              session.status === "live"
                ? session.autoSelectEnabled
                  ? "Live · Auto"
                  : "Live · Paused"
                : session.status
            }
            statusActive={session.status === "live"}
          >
            {canStartSession ? (
              <div className="flex justify-end">
                <button
                  onClick={() => void runControlAction("start-session")}
                  disabled={workingAction === "start-session"}
                  className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
                >
                  {workingAction === "start-session"
                    ? seedRender?.canRecover ? "Recovering..." : "Starting..."
                    : seedRender?.canRecover
                      ? "Recover First Video"
                    : session.status === "live"
                      ? "Retry First Video"
                      : session.status === "stopped"
                      ? "Restart Session"
                      : "Start Session"}
                </button>
              </div>
            ) : null}

            <div className={`${canStartSession ? "mt-6" : ""} flex flex-wrap gap-3`}>
              <ControlButton
                active={workingAction === "pause-selection"}
                label={session.autoSelectEnabled ? "Pause Selection" : "Resume Selection"}
                onClick={() => void runControlAction(session.autoSelectEnabled ? "pause-selection" : "resume-selection")}
              />
              <ControlButton
                active={workingAction === "skip-next"}
                disabled={!playback?.nextAsset}
                label="Skip To Next"
                onClick={() => void runControlAction("skip-next")}
              />
              <ControlButton
                active={workingAction === "fallback-remix"}
                label="Fallback Remix"
                onClick={() => void runControlAction("fallback-remix")}
              />
              <ControlButton active={workingAction === "stop-session"} label="Stop Session" onClick={() => void runControlAction("stop-session")} />
            </div>

            <p className="mt-4 text-sm text-white/62">
              {playback?.nextAsset
                ? "A ready next loop is loaded, so Skip To Next can cut over immediately."
                : snapshot.queueHealth.waitingOnRender
                  ? "Skip To Next will unlock after the current render finishes and loads as the next loop."
                  : "No next loop is ready yet. Queue a fallback remix or wait for a crowd render to finish."}
            </p>

            <details
              ref={generationMenuRef}
              className="group mt-6 rounded-4xl border border-white/10 bg-black/20 open:border-plasma/35 open:bg-plasma/[0.04]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-white/88 marker:content-none">
                <span>Previous generations</span>
                <span className="flex items-center gap-3 text-xs font-normal text-white/48">
                  {previousGenerations.length} available
                  <span aria-hidden="true" className="text-plasma transition-transform group-open:rotate-180">⌄</span>
                </span>
              </summary>

              <div className="border-t border-white/10 p-3">
                {previousGenerations.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-white/52">Completed generations will appear here after the first remix finishes.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {previousGenerations.map((asset) => {
                      const userPrompt = asset.sourceSubmission?.rawText?.trim();
                      const isWorking = workingAction === `cue-generation:${asset.id}`;

                      return (
                        <button
                          key={asset.id}
                          type="button"
                          disabled={Boolean(workingAction) || session.status !== "live"}
                          onClick={() => {
                            generationMenuRef.current?.removeAttribute("open");
                            void runControlAction("cue-generation", undefined, asset.id);
                          }}
                          className="block w-full rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left transition hover:border-plasma/40 hover:bg-plasma/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-plasma">
                              {userPrompt ? "User prompt" : asset.kind === "seed" ? "Initial generation" : "Fallback remix"}
                            </span>
                            <span className="text-xs text-white/38">{formatRelativeTime(asset.createdAt)}</span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/78">
                            {userPrompt || (asset.kind === "seed" ? "Original session visual" : "Generated fallback visual")}
                          </p>
                          <p className="mt-2 text-xs text-white/42">
                            {isWorking ? "Crossfading…" : asset.id === playback?.nextAsset?.id ? "Currently queued · click to take now" : "Click to cue and crossfade now"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>

            <details className="group/overlays mt-6 overflow-hidden rounded-4xl border border-white/10 bg-white/[0.04] open:border-plasma/30">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 outline-none transition hover:bg-white/[0.035] focus-visible:bg-white/[0.05] [&::-webkit-details-marker]:hidden">
                <div>
                  <p className="text-sm font-semibold text-white/88">Display overlays</p>
                  <p className="mt-1 text-xs text-white/48">
                    QR, wordmark, audio-reactive targeting, and render progress.
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/48">
                  {enabledOverlayCount} visible
                  <span
                    aria-hidden="true"
                    className="text-lg text-plasma transition-transform group-open/overlays:rotate-180"
                  >
                    ⌄
                  </span>
                </span>
              </summary>

              <div className="border-t border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-white/88">{twitchMode ? "Twitch chat overlay" : "Audience QR overlay"}</p>
                  <p className="mt-1 text-xs leading-5 text-white/52">
                    {twitchMode ? "Show the instruction to type !next in chat to continue the story." : "Show a QR code so viewers can send the next part of the story."}
                  </p>
                </div>

                <label className="inline-flex h-7 w-12 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={qrOverlayVisible}
                    disabled={workingAction === "set-qr-overlay"}
                    onChange={(event) => void updateQrOverlayVisibility(event.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="relative h-7 w-12 rounded-full border border-white/15 bg-black/40 transition after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white/65 after:transition-all after:content-[''] peer-checked:border-plasma/50 peer-checked:bg-plasma/20 peer-checked:after:translate-x-5 peer-checked:after:bg-plasma peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plasma" />
                  <span className="sr-only">{twitchMode ? "Show Twitch chat instructions on the show output" : "Show audience QR code on the show output"}</span>
                </label>
                </div>

              <div className="border-t border-white/10 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-xl">
                    <p className="text-sm font-semibold text-white/88">Centered wordmark overlay</p>
                    <p className="mt-1 text-xs leading-5 text-white/52">
                      Place the Vivid Fever Dreams wordmark in the center of the live output.
                    </p>
                  </div>

                  <label className="inline-flex h-7 w-12 shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={wordmarkOverlayVisible}
                      disabled={workingAction === "set-wordmark-overlay"}
                      onChange={(event) => void updateWordmarkOverlayVisibility(event.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="relative h-7 w-12 rounded-full border border-white/15 bg-black/40 transition after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white/65 after:transition-all after:content-[''] peer-checked:border-plasma/50 peer-checked:bg-plasma/20 peer-checked:after:translate-x-5 peer-checked:after:bg-plasma peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plasma" />
                    <span className="sr-only">Show the centered wordmark on the show output</span>
                  </label>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <label htmlFor="wordmark-opacity" className="text-xs font-medium text-white/62">
                    Wordmark opacity
                  </label>
                  <output
                    htmlFor="wordmark-opacity"
                    className="font-mono text-xs tabular-nums text-plasma sm:text-right"
                  >
                    {Math.round(wordmarkOpacity * 100)}%
                  </output>
                  <input
                    id="wordmark-opacity"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={wordmarkOpacity}
                    aria-label="Wordmark opacity"
                    onChange={(event) => setPendingWordmarkOpacity(Number(event.target.value))}
                    onPointerUp={(event) => void commitWordmarkOpacity(Number(event.currentTarget.value))}
                    onKeyUp={(event) => void commitWordmarkOpacity(Number(event.currentTarget.value))}
                    onBlur={(event) => void commitWordmarkOpacity(Number(event.currentTarget.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-plasma sm:col-span-2"
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <label htmlFor="wordmark-size" className="text-xs font-medium text-white/62">
                    Wordmark size
                  </label>
                  <output
                    htmlFor="wordmark-size"
                    className="font-mono text-xs tabular-nums text-plasma sm:text-right"
                  >
                    {Math.round(wordmarkSize * 100)}%
                  </output>
                  <input
                    id="wordmark-size"
                    type="range"
                    min="0.3"
                    max="1.5"
                    step="0.01"
                    value={wordmarkSize}
                    aria-label="Wordmark size"
                    onChange={(event) => setPendingWordmarkSize(Number(event.target.value))}
                    onPointerUp={(event) => void commitWordmarkSize(Number(event.currentTarget.value))}
                    onKeyUp={(event) => void commitWordmarkSize(Number(event.currentTarget.value))}
                    onBlur={(event) => void commitWordmarkSize(Number(event.currentTarget.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-plasma sm:col-span-2"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-4">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-white/88">Audio-reactive VFX: wordmark only</p>
                  <p className="mt-1 text-xs leading-5 text-white/52">
                    Keep the generated footage clean and apply the selected audio-reactive effect only to the wordmark layer.
                  </p>
                </div>

                <label className="inline-flex h-7 w-12 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={wordmarkAudioReactiveOnly}
                    disabled={workingAction === "set-wordmark-audio-reactive-only"}
                    onChange={(event) => void updateWordmarkAudioReactiveOnly(event.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="relative h-7 w-12 rounded-full border border-white/15 bg-black/40 transition after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white/65 after:transition-all after:content-[''] peer-checked:border-plasma/50 peer-checked:bg-plasma/20 peer-checked:after:translate-x-5 peer-checked:after:bg-plasma peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plasma" />
                  <span className="sr-only">Apply audio-reactive effects only to the wordmark</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-4">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-white/88">Next-remix progress overlay</p>
                  <p className="mt-1 text-xs leading-5 text-white/52">
                    Show “DREAM SEQUENCE” and the current video render activity across the top of the live visual.
                  </p>
                </div>

                <label className="inline-flex h-7 w-12 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={progressOverlayVisible}
                    disabled={workingAction === "set-progress-overlay"}
                    onChange={(event) => void updateProgressOverlayVisibility(event.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="relative h-7 w-12 rounded-full border border-white/15 bg-black/40 transition after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white/65 after:transition-all after:content-[''] peer-checked:border-plasma/50 peer-checked:bg-plasma/20 peer-checked:after:translate-x-5 peer-checked:after:bg-plasma peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-plasma" />
                  <span className="sr-only">Show next-remix progress on the show output</span>
                </label>
              </div>
              </div>
            </details>
          </DashboardDisclosure>

          <DashboardDisclosure
            eyebrow="Incoming crowd prompts"
            title="Audience Requests"
            description="Review the latest nicknames, raw requests, scores, and winning prompts."
            status={`${session.submissions.length} recent`}
          >
            <div className="space-y-4">
              {session.submissions.length === 0 ? (
                <EmptyState
                  title="No audience requests yet"
                  body={
                    session.status === "live"
                      ? twitchMode
                        ? "Ask your viewers to type !next followed by their story idea in Twitch chat."
                        : "Share the audience QR code to start collecting ideas for what happens next."
                      : "Restart the session first, then new audience requests will appear here in real time."
                  }
                />
              ) : (
                session.submissions.map((submission: any) => (
                  <div key={submission.id} className="rounded-4xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/60">
                          {(submission.source === "web" || submission.source === "twitch") && submission.sender
                            ? submission.sender
                            : submission.source}
                        </span>
                        <span className="text-xs uppercase tracking-[0.24em] text-white/40">{submission.status}</span>
                      </div>
                      <span className="text-xs text-white/45">{formatRelativeTime(submission.createdAt)}</span>
                    </div>

                    <p className="mt-4 text-base leading-7 text-white/82">{submission.rawText}</p>

                    {submission.referenceImageUrl ? (
                      <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-3xl border border-white/10">
                        <Image
                          src={submission.referenceImageUrl}
                          alt="Audience remix reference"
                          fill
                          unoptimized
                          sizes="(max-width: 768px) 100vw, 480px"
                          className="object-cover"
                        />
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 md:grid-cols-[0.35fr_1fr]">
                      <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/45">Score</p>
                        <p className="mt-2 text-2xl font-semibold text-white">{submission.rankingResult?.score ?? "-"}</p>
                      </div>
                      <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/45">Winning Prompt</p>
                        <p className="mt-2 text-sm leading-6 text-white/68">
                          {submission.rankingResult?.winningPrompt ?? submission.approvalReason ?? "Waiting for assessment"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DashboardDisclosure>
        </div>

        <div className="space-y-6">
          <DashboardDisclosure
            eyebrow="System"
            title="AI Environment"
            description="Current video generation and OpenAI text-scoring configuration."
            status={googleStatus.configured ? "Connected" : "Setup needed"}
            statusActive={googleStatus.configured}
          >
            <p className="text-sm leading-7 text-white/72">
              {googleStatus.configured
                ? `H3 Max is connected through fal.ai. Every clip is ${session.videoDurationSeconds} seconds at ${session.videoResolution.toLowerCase()}.`
                : "Video generation is not connected yet. Ask your platform administrator to enable H3 Max."}
            </p>
            <p className="mt-3 text-sm leading-7 text-white/60">
              Each new clip starts from the last frame of the previous scene.
              {openAiStatus.configured ? " AI moderation and story selection are active." : " Built-in moderation and story selection are active."}
            </p>
          </DashboardDisclosure>

          <DashboardDisclosure
            eyebrow="Output"
            title="Show Links"
            description="Open, copy, or share the projection and audience destinations."
            status="6 links"
          >
            <div className="space-y-4">
              <button
                onClick={openShowPopout}
                className="block w-full rounded-4xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-plasma/40"
              >
                <p className="text-sm font-semibold text-white">Pop Out Show Window</p>
                <p className="mt-2 text-sm text-white/60">Open a separate clean show window with no fullscreen prompt.</p>
              </button>
              <a
                href={showLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-4xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-plasma/40"
              >
                <p className="text-sm font-semibold text-white">Open In New Tab</p>
                <p className="mt-2 text-sm text-white/60">Use a plain browser link if scripted popup opens are blocked.</p>
              </a>
              <button
                onClick={() => void copyShowUrl()}
                className="block w-full rounded-4xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-plasma/40"
              >
                <p className="text-sm font-semibold text-white">Copy Show URL</p>
                <p className="mt-2 text-sm text-white/60">Use this if the in-app browser blocks popups.</p>
              </button>
              <div className="rounded-4xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">Show URL</p>
                <p className="mt-2 break-all font-mono text-xs text-white/60">{showUrlDisplay || showLink}</p>
              </div>
              <LinkCard label={twitchMode ? "Twitch Chat" : "What Happens Next?"} href={publicLink} />
              <LinkCard label="Projection View" href={showLink} newTab />
            </div>
          </DashboardDisclosure>

          <DashboardDisclosure
            eyebrow="Generation"
            title="Render Jobs"
            description="Inspect active video jobs and recent completed or failed renders."
            status={renderJobsStatus}
            statusActive={Boolean(activeRenderJob)}
          >
            <div className="space-y-4">
              {session.renderJobs.length === 0 ? (
                <EmptyState title="No renders yet" body="Start the session to seed the first loop, then new crowd winners will appear here." />
              ) : (
                session.renderJobs.map((job: any) => (
                  <div key={job.id} className="rounded-4xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{job.mode === "seed" ? "Seed Render" : "DREAM SEQUENCE"}</p>
                      <span className="text-xs uppercase tracking-[0.24em] text-white/40">
                        {job.status === "queued" || job.status === "in_progress"
                          ? `${(renderProgress[job.id] ?? job.progress ?? undefined) === undefined ? "" : `~${renderProgress[job.id] ?? job.progress}% estimated · `}${job.status.replace("_", " ")}`
                          : job.status}
                      </span>
                    </div>
                    {job.status === "queued" || job.status === "in_progress" ? (
                      <GenerationProgressBar
                        progress={renderProgress[job.id] ?? job.progress ?? undefined}
                        compact
                      />
                    ) : null}
                    <p className="mt-3 text-sm leading-6 text-white/68">{job.promptText}</p>
                    {job.status === "failed" && job.failureReason ? (
                      <p className="mt-3 text-sm leading-6 text-ember">
                        {job.failureReason}
                      </p>
                    ) : null}
                    {job.status === "failed" && job.moderationDiagnostic ? (
                      <p className="mt-2 text-xs leading-5 text-ember/80">
                        Provider diagnostic:{" "}
                        {getVideoModerationDiagnosticLabel(
                          job.moderationDiagnostic
                        )}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </DashboardDisclosure>

          <DashboardDisclosure
            eyebrow="Your story"
            title="Opening Scene"
            description="Where the story begins and how your audience joins in."
            status={twitchMode ? "Twitch" : "QR code"}
          >
            <div className="space-y-4 text-sm leading-7 text-white/74">
              <p className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3">{session.basePrompt}</p>
              <p>{videoModel.label} · {session.videoDurationSeconds} seconds · {session.videoResolution.toLowerCase()}</p>
              <p>{twitchMode ? `Viewers continue the story with !next in ${session.twitchChannel || "your"} Twitch chat.` : "Viewers scan the QR code and answer: What happens next?"}</p>
            </div>
          </DashboardDisclosure>
        </div>
      </section>

      <footer className="mt-10 flex justify-center border-t border-white/10 pt-6">
        <a
          href="https://fal.ai/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/45 transition hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-plasma"
        >
          H3 Max · Powered by fal.ai
        </a>
      </footer>
    </main>
  );
}

function InitialGenerationStatus({
  job,
  progress,
  isStarting,
  failed,
  failureReason
}: {
  job?: InitialGenerationJob;
  progress?: number;
  isStarting: boolean;
  failed: boolean;
  failureReason: string | null;
}) {
  const hasMeasuredProgress = !isStarting && typeof progress === "number";
  const title = failed
    ? job?.canRecover ? "Your first video is ready to recover" : "First video generation failed"
    : isStarting && job?.canRecover ? "Recovering your first video" : "Generating your first video";
  const stage = isStarting
    ? job?.canRecover ? "Preparing your existing clip for playback…" : "Starting the generation job…"
    : job?.status === "queued"
      ? "Queued for video generation — waiting for rendering to begin…"
      : "The video renderer is creating your first loop…";

  return (
    <section
      aria-live="polite"
      aria-busy={!failed}
      className={`panel relative mt-8 overflow-hidden border p-6 sm:p-8 ${
        failed ? "border-ember/35 bg-ember/8" : "border-plasma/25 bg-plasma/[0.07]"
      }`}
    >
      {!failed ? (
        <div aria-hidden="true" className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-plasma/15 blur-3xl" />
      ) : null}
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          {!failed ? (
            <span aria-hidden="true" className="mt-1 h-8 w-8 shrink-0 animate-spin rounded-full border-[3px] border-plasma/20 border-t-plasma" />
          ) : (
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember/15 text-lg text-ember">!</span>
          )}
          <div>
            <p className={`font-mono text-[11px] uppercase tracking-[0.3em] ${failed ? "text-ember" : "text-plasma"}`}>
              Initial generation
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">{title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/70">
              {failed
                ? failureReason ||
                  "The video renderer could not finish this render. Retry the generation."
                : `${stage} You can keep this dashboard open; the first video will load automatically when it is ready.`}
            </p>
          </div>
        </div>

        {!failed ? (
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-4xl font-semibold tabular-nums text-white">
              {hasMeasuredProgress ? `~${progress}%` : "Working"}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.22em] text-white/45">
              {hasMeasuredProgress ? "estimated progress" : "waiting for first update"}
            </p>
          </div>
        ) : null}
      </div>

      {!failed ? <GenerationProgressBar progress={hasMeasuredProgress ? progress : undefined} /> : null}
    </section>
  );
}

function GenerationProgressBar({ progress, compact = false }: { progress?: number; compact?: boolean }) {
  const hasProgress = typeof progress === "number";

  return (
    <div
      role="progressbar"
      aria-label="Video generation progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={hasProgress ? progress : undefined}
      className={`${compact ? "mt-3 h-1.5" : "mt-7 h-2.5"} overflow-hidden rounded-full bg-black/35`}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r from-tide via-plasma to-haze transition-[width] duration-700 ${
          hasProgress ? "" : "w-1/3 animate-pulse"
        }`}
        style={hasProgress ? { width: `${progress}%` } : undefined}
      />
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/42">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold text-white">{value}</p>
        <p className="text-xs uppercase tracking-[0.2em] text-white/35">{hint}</p>
      </div>
    </div>
  );
}

function PlaybackCard({
  title,
  assetTitle,
  prompt,
  status
}: {
  title: string;
  assetTitle: string;
  prompt: string;
  status: string;
}) {
  return (
    <div className="border-b border-white/10 p-6 last:border-b-0 lg:border-b-0 lg:border-r last:lg:border-r-0">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">{title}</p>
      <p className="mt-4 text-2xl font-semibold text-white">{assetTitle}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-plasma">{status}</p>
      <p className="mt-5 text-sm leading-7 text-white/68">{prompt}</p>
    </div>
  );
}

function ControlButton({
  label,
  active,
  disabled,
  onClick
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || active}
      className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/82 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {active ? "Working..." : label}
    </button>
  );
}

function LinkCard({ label, href, newTab = false }: { label: string; href: string; newTab?: boolean }) {
  return (
    <Link
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className="block rounded-4xl border border-white/10 bg-black/20 p-4 transition hover:border-plasma/40"
    >
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-2 text-sm text-white/60">{href}</p>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-4xl border border-dashed border-white/14 bg-black/15 p-5">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-3 text-sm leading-7 text-white/65">{body}</p>
    </div>
  );
}

function StatusNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel border border-amber-300/20 bg-amber-300/8 p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-amber-200/90">{title}</p>
      <p className="mt-3 text-sm leading-7 text-white/78">{body}</p>
    </div>
  );
}

function resolveAbsoluteUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function describeDashboardRequestError(error: unknown, context: string) {
  if (error instanceof Error) {
    if (error.message === "Failed to fetch") {
      return `${context} failed because the dashboard could not reach the local app server. Refresh the page and try again.`;
    }

    return error.message;
  }

  return `${context} failed. Refresh the page and try again.`;
}
