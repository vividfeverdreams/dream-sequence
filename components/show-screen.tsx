"use client";

import type { CSSProperties } from "react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioReactiveControlsPanel,
  useAudioReactiveController
} from "@/components/audio-reactive-controls";
import {
  AUDIO_REACTIVE_PRESET_MAP,
  clamp,
  type AudioReactiveMetrics,
  type AudioReactiveSharedState,
  type VisualTransitionStyle
} from "@/lib/audio-reactive";
import type { SessionSnapshot } from "@/lib/snapshot";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  openAiConfigured: boolean;
  cleanOutput?: boolean;
};

type ActiveVisualTransition = {
  assetId: string;
  style: VisualTransitionStyle;
  durationMs: number;
  reason: "manual" | "auto" | "dashboard";
};

const SHOW_STAGE_FRAME_STYLE: CSSProperties = {
  width: "min(100vw, calc(100vh * 16 / 9))",
  height: "min(100vh, calc(100vw * 9 / 16))"
};

export function ShowScreen({ initialSnapshot, openAiConfigured, cleanOutput = false }: ShowScreenProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [fadeNext, setFadeNext] = useState(false);
  const [activeTransition, setActiveTransition] = useState<ActiveVisualTransition | null>(null);
  const [consumedSongChangeId, setConsumedSongChangeId] = useState<string | null>(null);
  const [showFxPanel, setShowFxPanel] = useState(false);
  const nextVideoRef = useRef<HTMLVideoElement>(null);
  const transitionTimeoutsRef = useRef<number[]>([]);
  const activeTransitionAssetIdRef = useRef<string | null>(null);

  const session = snapshot.session;
  const audioReactive = useAudioReactiveController(session.id, "show-screen");
  const audioReactiveRef = useRef(audioReactive);
  const playback = session.playbackState;
  const currentAsset = playback?.currentAsset ?? null;
  const nextAsset = playback?.nextAsset ?? null;
  const currentAssetUrl = resolvePlaybackUrl(currentAsset?.publicUrl ?? null);
  const nextAssetUrl = resolvePlaybackUrl(nextAsset?.publicUrl ?? null);
  const shouldRenderNext = Boolean(nextAssetUrl);
  const activePreset = AUDIO_REACTIVE_PRESET_MAP[audioReactive.sharedState.presetId];
  const visualFx = useMemo(
    () => buildVisualFxState(audioReactive.sharedState, audioReactive.activeMetrics),
    [audioReactive.activeMetrics, audioReactive.sharedState]
  );

  useEffect(() => {
    audioReactiveRef.current = audioReactive;
  }, [audioReactive]);

  useEffect(() => {
    if (!cleanOutput || typeof document === "undefined") {
      return;
    }

    const previousOutputMode = document.documentElement.dataset.showOutput;
    document.documentElement.dataset.showOutput = "clean";

    return () => {
      if (previousOutputMode) {
        document.documentElement.dataset.showOutput = previousOutputMode;
        return;
      }

      delete document.documentElement.dataset.showOutput;
    };
  }, [cleanOutput]);

  useEffect(() => {
    const stream = new EventSource(`/api/sessions/${session.id}/stream`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data) as NonNullable<SessionSnapshot>;
      startTransition(() => {
        setSnapshot(payload);
      });
    };

    return () => {
      stream.close();
    };
  }, [session.id]);

  const clearTransitionTimers = useCallback(() => {
    transitionTimeoutsRef.current.forEach((timerId) => window.clearTimeout(timerId));
    transitionTimeoutsRef.current = [];
  }, []);

  const startVisualTransition = useCallback(
    (style: VisualTransitionStyle, reason: ActiveVisualTransition["reason"], requestedSeconds?: number) => {
      if (!nextAsset?.id || !nextAssetUrl || activeTransitionAssetIdRef.current === nextAsset.id) {
        return false;
      }

      const durationMs = style === "hard-cut"
        ? 90
        : Math.round(Math.max(0.35, requestedSeconds ?? 2.2) * 1000);

      clearTransitionTimers();
      activeTransitionAssetIdRef.current = nextAsset.id;
      setActiveTransition({
        assetId: nextAsset.id,
        style,
        durationMs,
        reason
      });

      const startTimer = window.setTimeout(() => {
        nextVideoRef.current?.play().catch(() => undefined);
        setFadeNext(true);
      }, style === "hard-cut" ? 0 : 90);

      const finalizeTimer = window.setTimeout(async () => {
        await fetch(`/api/sessions/${session.id}/transition`, {
          method: "POST"
        });
        activeTransitionAssetIdRef.current = null;
        setFadeNext(false);
        setActiveTransition(null);
      }, durationMs + (style === "hard-cut" ? 40 : 160));

      transitionTimeoutsRef.current = [startTimer, finalizeTimer];
      return true;
    },
    [clearTransitionTimers, nextAsset?.id, nextAssetUrl, session.id]
  );

  useEffect(() => {
    if (!nextAsset?.id) {
      setFadeNext(false);
      setActiveTransition(null);
      activeTransitionAssetIdRef.current = null;
      return;
    }
  }, [nextAsset?.id]);

  useEffect(() => {
    return () => {
      clearTransitionTimers();
    };
  }, [clearTransitionTimers]);

  useEffect(() => {
    if (playback?.status !== "transitioning" || !nextAsset?.id) {
      return;
    }

    const requestedSeconds = playback.crossfadeSeconds ?? 0;
    startVisualTransition(requestedSeconds <= 0.12 ? "hard-cut" : "fade", "dashboard", requestedSeconds);
  }, [nextAsset?.id, playback?.crossfadeSeconds, playback?.status, startVisualTransition]);

  useEffect(() => {
    const songChange = audioReactive.lastSongChange;

    if (
      audioReactive.sharedState.switchMode !== "auto" ||
      !songChange ||
      songChange.id === consumedSongChangeId ||
      !nextAsset?.id
    ) {
      return;
    }

    if (Date.now() - songChange.detectedAt > 45000) {
      return;
    }

    const didStart = startVisualTransition(
      songChange.transitionStyle,
      "auto",
      songChange.transitionStyle === "fade" ? 2.2 : 0
    );

    if (didStart) {
      setConsumedSongChangeId(songChange.id);
    }
  }, [
    audioReactive.lastSongChange,
    audioReactive.sharedState.switchMode,
    consumedSongChangeId,
    nextAsset?.id,
    startVisualTransition
  ]);

  useEffect(() => {
    const handleShowKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const targetTag = target?.tagName;

      if (target?.isContentEditable || targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") {
        return;
      }

      const controller = audioReactiveRef.current;

      if (event.key === "[") {
        event.preventDefault();
        controller.cyclePreset(-1);
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        controller.cyclePreset(1);
        return;
      }

      if (event.key === "\\") {
        event.preventDefault();
        controller.setPresetId("bypass");
        return;
      }

      if (event.key.toLowerCase() === "a") {
        event.preventDefault();

        if (controller.localCaptureActive) {
          controller.stopCapture();
        } else {
          void controller.startCapture();
        }

        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        startVisualTransition(
          controller.sharedState.manualTransitionStyle,
          "manual",
          controller.sharedState.manualTransitionStyle === "fade" ? 2.2 : 0
        );
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowFxPanel((currentValue) => !currentValue);
      }
    };

    window.addEventListener("keydown", handleShowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleShowKeyDown);
    };
  }, [startVisualTransition]);

  const debugLabel = activeTransition
    ? `${activeTransition.style === "hard-cut" ? "Hard cutting" : "Fading"} to queued remix`
    : !currentAsset
    ? session.status === "draft"
      ? "Start the session from the dashboard to seed the first loop"
      : "Holding for first completed loop"
    : nextAsset
      ? audioReactive.sharedState.switchMode === "auto"
        ? "Auto switch armed for the next detected song change"
        : "Manual switch armed"
      : "Live loop stable";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <div className="relative overflow-hidden bg-black" style={SHOW_STAGE_FRAME_STYLE}>
        <div className="absolute inset-0 overflow-hidden" style={visualFx.stageStyle}>
          {currentAssetUrl ? (
            <video
              key={currentAsset.id}
              className="absolute inset-0 h-full w-full object-cover"
              style={visualFx.videoStyle}
              src={currentAssetUrl}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <div className="absolute inset-0 subtle-grid bg-aurora" />
          )}

          {shouldRenderNext && nextAssetUrl ? (
            <video
              key={nextAsset.id}
              ref={nextVideoRef}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                ...visualFx.videoStyle,
                opacity: fadeNext ? 1 : 0,
                transitionDuration: `${activeTransition?.durationMs ?? 2200}ms, 75ms`,
                transitionTimingFunction: activeTransition?.style === "hard-cut" ? "steps(1, end), linear" : "ease, linear"
              }}
              src={nextAssetUrl}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-0" style={visualFx.prismOverlayStyle} />
        <div className="pointer-events-none absolute inset-0" style={visualFx.bloomOverlayStyle} />
        <div className="pointer-events-none absolute inset-0" style={visualFx.scanlineOverlayStyle} />
        <div className="pointer-events-none absolute inset-0" style={visualFx.flashOverlayStyle} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />
        <div className="pointer-events-none absolute inset-0" style={visualFx.atmosphereOverlayStyle} />

        {!cleanOutput ? (
          <div className="absolute right-4 top-4 z-20 flex max-w-[28rem] flex-col items-end gap-3">
            <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setShowFxPanel((currentValue) => !currentValue)}
                className="rounded-md border border-[#3a3d3f] bg-[#181a1d]/88 px-4 py-2 text-sm font-semibold text-white shadow-[0_18px_55px_rgba(0,0,0,0.34)] backdrop-blur-xl transition hover:border-[#baff39]"
              >
                FX {activePreset.shortLabel} · {audioReactive.activeSourceLabel ? "audio live" : "audio idle"}
              </button>
              <button
                onClick={() => startVisualTransition("hard-cut", "manual", 0)}
                disabled={!nextAsset || Boolean(activeTransition)}
                className="rounded-md border border-[#3a3d3f] bg-[#232529]/92 px-3 py-2 text-sm font-semibold text-[#e5e1d8] backdrop-blur-xl transition hover:border-[#ff764d] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Cut
              </button>
              <button
                onClick={() => startVisualTransition("fade", "manual", 2.2)}
                disabled={!nextAsset || Boolean(activeTransition)}
                className="rounded-md border border-[#3a3d3f] bg-[#232529]/92 px-3 py-2 text-sm font-semibold text-[#e5e1d8] backdrop-blur-xl transition hover:border-[#baff39] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Fade
              </button>
            </div>

            {showFxPanel ? <AudioReactiveControlsPanel controller={audioReactive} variant="show" className="pointer-events-auto w-full" /> : null}
          </div>
        ) : null}

        {!cleanOutput ? (
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-6 p-6">
            <div className="max-w-3xl rounded-lg border border-[#3a3d3f] bg-[#15171a]/72 px-5 py-4 backdrop-blur">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#baff39]">{session.artistName}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{session.trackName}</p>
              <p className="mt-3 text-sm text-[#c9c7bd]">{debugLabel}</p>
              {!openAiConfigured ? <p className="mt-2 text-xs uppercase tracking-[0.22em] text-amber-200/90">Demo loop fallback active</p> : null}
            </div>

            <div className="rounded-lg border border-[#3a3d3f] bg-[#15171a]/72 px-5 py-4 text-right backdrop-blur">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#8f9499]">Queue</p>
              <p className="mt-2 text-sm text-[#c9c7bd]">
                {nextAsset ? "Next remix loaded" : snapshot.queueHealth.waitingOnRender ? "Rendering next remix" : "Loop secured"}
              </p>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8f9499]">
                {audioReactive.sharedState.switchMode} · FX {activePreset.shortLabel}
                {audioReactive.activeSourceLabel ? ` · ${audioReactive.activeSourceLabel}` : " · waiting for audio input"}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

type VisualFxState = {
  stageStyle: CSSProperties;
  videoStyle: CSSProperties;
  prismOverlayStyle: CSSProperties;
  bloomOverlayStyle: CSSProperties;
  scanlineOverlayStyle: CSSProperties;
  flashOverlayStyle: CSSProperties;
  atmosphereOverlayStyle: CSSProperties;
};

function buildVisualFxState(state: AudioReactiveSharedState, metrics: AudioReactiveMetrics): VisualFxState {
  const now = typeof window === "undefined" ? 0 : window.performance.now();
  const intensity = state.presetId === "bypass" ? 0 : state.intensity;
  const low = metrics.low * intensity;
  const mid = metrics.mid * intensity;
  const high = metrics.high * intensity;
  const energy = metrics.energy * intensity;
  const transient = metrics.transient * intensity;
  const beat = metrics.beat * intensity;

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let rotate = 0;
  let brightness = 1 + energy * 0.05;
  let contrast = 1 + transient * 0.08;
  let saturate = 1 + mid * 0.08;
  let blur = 0;
  let hueRotate = 0;
  let prismOpacity = 0;
  let bloomOpacity = 0.12;
  let scanlineOpacity = 0;
  let flashOpacity = 0;
  let atmosphereOpacity = 0.12;

  switch (state.presetId) {
    case "pulse":
      scale += low * 0.08 + beat * 0.05;
      brightness += beat * 0.18;
      contrast += low * 0.16;
      bloomOpacity += low * 0.24;
      atmosphereOpacity += low * 0.12;
      break;
    case "strobe":
      brightness += beat * 0.28;
      contrast += transient * 0.24;
      flashOpacity = clamp(beat * 0.72 + transient * 0.34, 0, 0.72);
      scanlineOpacity = clamp(0.08 + high * 0.14, 0, 0.32);
      break;
    case "impact-shake":
      translateX = Math.sin(now / 28) * (low * 16 + transient * 10);
      translateY = Math.cos(now / 34) * (beat * 12 + low * 4);
      scale += beat * 0.025;
      contrast += transient * 0.22;
      bloomOpacity += transient * 0.16;
      break;
    case "tilt-drift":
      rotate = Math.sin(now / 340) * (low * 4.5 + mid * 2.2);
      translateY = Math.sin(now / 280) * mid * 8;
      scale += low * 0.03;
      hueRotate += mid * 14;
      bloomOpacity += mid * 0.16;
      break;
    case "zoom-burst":
      scale += beat * 0.16 + transient * 0.08;
      brightness += beat * 0.22;
      contrast += transient * 0.3;
      saturate += high * 0.2;
      atmosphereOpacity += beat * 0.1;
      break;
    case "prism-split":
      scale += beat * 0.03;
      saturate += high * 0.48;
      hueRotate += high * 24 + mid * 10;
      prismOpacity = clamp(high * 0.75 + energy * 0.18, 0, 0.82);
      bloomOpacity += high * 0.26;
      break;
    case "echo-bloom":
      blur += mid * 1.2 + energy * 0.8;
      brightness += energy * 0.16;
      saturate += mid * 0.26;
      bloomOpacity += mid * 0.36 + energy * 0.12;
      atmosphereOpacity += mid * 0.12;
      break;
    case "hue-drift":
      hueRotate += Math.sin(now / 520) * 18 + mid * 52 + high * 18;
      saturate += mid * 0.58 + high * 0.18;
      brightness += high * 0.12;
      prismOpacity = clamp(high * 0.24, 0, 0.32);
      bloomOpacity += mid * 0.22;
      break;
    case "scanline-glitch":
      translateX = Math.sin(now / 26) * high * 6 + Math.sin(now / 7) * transient * 9;
      brightness += transient * 0.12;
      contrast += high * 0.34;
      saturate += high * 0.18;
      prismOpacity = clamp(high * 0.22, 0, 0.28);
      scanlineOpacity = clamp(0.18 + high * 0.42 + transient * 0.2, 0, 0.78);
      flashOpacity = clamp(transient * 0.2, 0, 0.24);
      break;
    default:
      break;
  }

  return {
    stageStyle: {
      transform: `translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)}) rotate(${rotate.toFixed(3)}deg)`,
      filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) blur(${blur.toFixed(3)}px) hue-rotate(${hueRotate.toFixed(2)}deg)`,
      transformOrigin: "center center",
      transition: "transform 75ms linear, filter 75ms linear",
      willChange: "transform, filter"
    },
    videoStyle: {
      transition: "opacity 2200ms ease, filter 75ms linear"
    },
    prismOverlayStyle: {
      opacity: prismOpacity,
      background: "linear-gradient(118deg, rgba(255,70,162,0.38), rgba(255,70,162,0) 28%, rgba(54,215,255,0.28) 68%, rgba(54,215,255,0) 100%)",
      mixBlendMode: "screen",
      filter: `blur(${(10 + high * 22).toFixed(2)}px) saturate(180%)`,
      transform: `translate3d(${(high * 18).toFixed(2)}px, 0, 0) scale(${(1 + high * 0.04).toFixed(3)})`,
      transition: "opacity 75ms linear, transform 75ms linear, filter 75ms linear"
    },
    bloomOverlayStyle: {
      opacity: clamp(bloomOpacity, 0.08, 0.64),
      background:
        "radial-gradient(circle at 20% 18%, rgba(91,226,255,0.22), transparent 28%), radial-gradient(circle at 78% 20%, rgba(255,164,92,0.18), transparent 30%), radial-gradient(circle at 50% 82%, rgba(255,61,127,0.18), transparent 34%)",
      mixBlendMode: "screen",
      filter: `blur(${(32 + energy * 36).toFixed(2)}px)`,
      transition: "opacity 75ms linear, filter 75ms linear"
    },
    scanlineOverlayStyle: {
      opacity: scanlineOpacity,
      backgroundImage:
        "repeating-linear-gradient(180deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 1px, transparent 2px, transparent 6px)",
      backgroundSize: "100% 6px",
      mixBlendMode: "soft-light",
      transition: "opacity 75ms linear"
    },
    flashOverlayStyle: {
      opacity: flashOpacity,
      background: transient > beat ? "rgba(255, 244, 220, 0.92)" : "rgba(255, 255, 255, 0.82)",
      mixBlendMode: "screen",
      transition: "opacity 45ms linear"
    },
    atmosphereOverlayStyle: {
      opacity: clamp(atmosphereOpacity, 0.08, 0.42),
      background:
        "radial-gradient(circle at center, rgba(16,214,160,0.18), transparent 42%), radial-gradient(circle at 50% 12%, rgba(255,255,255,0.08), transparent 26%), linear-gradient(180deg, rgba(4,10,18,0.04) 0%, rgba(4,10,18,0.18) 100%)",
      mixBlendMode: "screen",
      transition: "opacity 75ms linear"
    }
  };
}

function resolvePlaybackUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const resolved = url.startsWith("/")
      ? new URL(url, "http://localhost")
      : new URL(url);

    if (
      (resolved.hostname === "localhost" || resolved.hostname === "127.0.0.1") &&
      resolved.pathname.startsWith("/api/assets/")
    ) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }

    return url;
  } catch {
    return url;
  }
}
