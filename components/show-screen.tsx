"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@/lib/snapshot";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  openAiConfigured: boolean;
};

export function ShowScreen({ initialSnapshot, openAiConfigured }: ShowScreenProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [fadeNext, setFadeNext] = useState(false);
  const [handledNextAssetId, setHandledNextAssetId] = useState<string | null>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null);

  const session = snapshot.session;
  const playback = session.playbackState;
  const currentAsset = playback?.currentAsset ?? null;
  const nextAsset = playback?.nextAsset ?? null;
  const currentAssetUrl = resolvePlaybackUrl(currentAsset?.publicUrl ?? null);
  const nextAssetUrl = resolvePlaybackUrl(nextAsset?.publicUrl ?? null);
  const shouldRenderNext = Boolean(nextAssetUrl);

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

  useEffect(() => {
    if (!nextAsset?.id || nextAsset.id === handledNextAssetId) {
      setFadeNext(false);
      return;
    }

    const startFade = window.setTimeout(() => {
      nextVideoRef.current?.play().catch(() => undefined);
      setFadeNext(true);
    }, 120);

    const finalize = window.setTimeout(async () => {
      await fetch(`/api/sessions/${session.id}/transition`, {
        method: "POST"
      });
      setHandledNextAssetId(nextAsset.id);
      setFadeNext(false);
    }, 2400);

    return () => {
      window.clearTimeout(startFade);
      window.clearTimeout(finalize);
    };
  }, [handledNextAssetId, nextAsset?.id, session.id]);

  const debugLabel = !currentAsset
    ? session.status === "draft"
      ? "Start the session from the dashboard to seed the first loop"
      : "Holding for first completed loop"
    : nextAsset
      ? "Crossfade armed"
      : "Live loop stable";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black">
      {currentAssetUrl ? (
        <video
          key={currentAsset?.id}
          className="absolute inset-0 h-full w-full object-cover"
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
          key={nextAsset?.id}
          ref={nextVideoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[2200ms] ${
            fadeNext ? "opacity-100" : "opacity-0"
          }`}
          src={nextAssetUrl}
          autoPlay
          loop
          muted
          playsInline
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-6 p-6">
        <div className="max-w-3xl rounded-4xl border border-white/10 bg-black/25 px-5 py-4 backdrop-blur">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-plasma">{session.artistName}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{session.trackName}</p>
          <p className="mt-3 text-sm text-white/70">{debugLabel}</p>
          {!openAiConfigured ? <p className="mt-2 text-xs uppercase tracking-[0.22em] text-amber-200/90">Demo loop fallback active</p> : null}
        </div>

        <div className="rounded-4xl border border-white/10 bg-black/25 px-5 py-4 text-right backdrop-blur">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Queue</p>
          <p className="mt-2 text-sm text-white/70">
            {nextAsset ? "Next remix loaded" : snapshot.queueHealth.waitingOnRender ? "Rendering next remix" : "Loop secured"}
          </p>
        </div>
      </div>
    </main>
  );
}

function resolvePlaybackUrl(url: string | null) {
  if (!url) {
    return null;
  }

  if (typeof window === "undefined") {
    return url;
  }

  try {
    const resolved = new URL(url, window.location.origin);

    if (
      resolved.hostname === "localhost" &&
      resolved.pathname.startsWith("/api/assets/")
    ) {
      return `${window.location.origin}${resolved.pathname}`;
    }

    return resolved.toString();
  } catch {
    return url;
  }
}
