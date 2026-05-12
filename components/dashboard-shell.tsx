"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import {
  AudioReactiveControlsPanel,
  useAudioReactiveController
} from "@/components/audio-reactive-controls";
import type { OpenAiConnectionStatus } from "@/lib/openai-key-store";
import type { SessionSnapshot } from "@/lib/snapshot";
import { formatRelativeTime } from "@/lib/utils";

type DashboardShellProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  currentUserName: string;
  initialOpenAiStatus: OpenAiConnectionStatus;
};

export function DashboardShell({
  initialSnapshot,
  currentUserName,
  initialOpenAiStatus
}: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);
  const [showWindowFeedback, setShowWindowFeedback] = useState<string | null>(null);
  const [showUrlDisplay, setShowUrlDisplay] = useState("");
  const deferredSnapshot = useDeferredValue(snapshot);
  const openAiStatus = initialOpenAiStatus;

  const session = deferredSnapshot.session;
  const audioReactive = useAudioReactiveController(session.id, "dashboard");
  const playback = session.playbackState;
  const publicLink = `/r/${session.code}`;
  const showLink = `/show/${session.id}`;
  const cleanShowLink = `${showLink}?output=clean`;
  const canStartSession = session.status !== "live";

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
    if (!deferredSnapshot.queueHealth.waitingOnRender) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetch(`/api/sessions/${session.id}/reconcile`, {
        method: "POST"
      });
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [deferredSnapshot.queueHealth.waitingOnRender, session.id]);

  useEffect(() => {
    setShowUrlDisplay(resolveAbsoluteUrl(cleanShowLink));
  }, [cleanShowLink]);

  async function runControlAction(action: string) {
    const controlAction = action === "cut-next" || action === "fade-next" ? "skip-next" : action;
    const transitionSeconds = action === "fade-next" ? 2.2 : 0;

    if (controlAction === "skip-next" && !snapshot.session.playbackState?.nextAsset) {
      setControlFeedback(
        snapshot.queueHealth.waitingOnRender
          ? "Visual switching is waiting on a ready loop. A remix is still rendering right now."
          : "Visual switching only works when a ready next loop is loaded."
      );
      return;
    }

    setControlFeedback(null);
    setWorkingAction(action);

    try {
      if (action === "start-session") {
        const response = await fetch(`/api/sessions/${session.id}/start`, {
          method: "POST"
        });

        if (!response.ok) {
          throw new Error("Could not start the session.");
        }
      } else if (action === "logout") {
        const response = await fetch("/api/auth/logout", {
          method: "POST"
        });

        if (!response.ok) {
          throw new Error("Could not log out right now.");
        }

        window.location.href = "/login";
        return;
      } else {
        const response = await fetch(`/api/sessions/${session.id}/control`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: controlAction,
            ...(controlAction === "skip-next" ? { transitionSeconds } : {})
          })
        });

        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Could not run that control action.");
        }
      }

      if (controlAction === "skip-next") {
        setControlFeedback(action === "fade-next" ? "Requested a fade to the queued remix." : "Requested a hard cut to the queued remix.");
      } else if (action === "fallback-remix") {
        setControlFeedback("Fallback remix queued. The show stays on the current loop until the new render is ready.");
      } else if (action === "pause-selection") {
        setControlFeedback("Automated crowd selection is paused.");
      } else if (action === "resume-selection") {
        setControlFeedback("Automated crowd selection resumed.");
      } else if (action === "stop-session") {
        setControlFeedback("Session stopped. Audience intake is offline until you restart it.");
      }
    } catch (error) {
      setControlFeedback(describeDashboardRequestError(error, "That dashboard action"));
    } finally {
      setWorkingAction(null);
    }
  }

  function openShowPopout() {
    const absoluteShowLink = resolveAbsoluteUrl(cleanShowLink);
    const popupWidth = 1280;
    const popupHeight = 720;
    const popupLeft = Math.max(0, Math.round(window.screenX + (window.outerWidth - popupWidth) / 2));
    const popupTop = Math.max(0, Math.round(window.screenY + (window.outerHeight - popupHeight) / 2));
    const popup = window.open(
      absoluteShowLink,
      "crowd-remix-show",
      `popup=yes,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop},resizable=yes,scrollbars=no`
    );

    if (popup) {
      popup.focus();
      setShowWindowFeedback("Show view opened in a 16:9 popout window.");
      return;
    }

    setShowWindowFeedback(
      "The in-app browser blocked the new tab. Use Open In New Tab or Copy Show URL in the Show Links card below."
    );
  }

  async function copyShowUrl() {
    const absoluteShowLink = resolveAbsoluteUrl(cleanShowLink);

    try {
      await navigator.clipboard.writeText(absoluteShowLink);
      setShowWindowFeedback("Show URL copied. Open it in another tab/window to watch the live screen while keeping this dashboard open.");
    } catch {
      setShowWindowFeedback("Could not copy the show URL automatically. The link is shown in the Show Links card below.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#baff39]">DJ Dashboard</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">{session.name}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#c9c7bd]">
            {session.artistName} - {session.trackName}. {currentUserName}, this control view keeps the queue moving while the current loop stays protected on screen.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={publicLink} className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-[#baff39]">
            Audience Form
          </Link>
          <button
            onClick={openShowPopout}
            className="rounded-md bg-[#baff39] px-4 py-2 text-sm font-semibold text-[#151515] transition hover:brightness-110"
          >
            Pop Out Show
          </button>
          <Link href={cleanShowLink} className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-[#00a7e1]">
            Fullscreen Show
          </Link>
          <button
            onClick={() => void runControlAction("logout")}
            className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-[#ff764d]"
          >
            {workingAction === "logout" ? "Leaving..." : "Logout"}
          </button>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Session Status" value={session.status} hint={playback?.status ?? "idle"} />
        <MetricCard label="Approved Queue" value={String(deferredSnapshot.queueHealth.approvedCount)} hint="scored safe prompts" />
        <MetricCard label="Render State" value={deferredSnapshot.queueHealth.waitingOnRender ? "busy" : "clear"} hint={`${deferredSnapshot.queueHealth.renderingCount} rendering`} />
        <MetricCard label="Ready Assets" value={String(deferredSnapshot.queueHealth.readyAssetCount)} hint="live or queued visuals" />
      </section>

      {showWindowFeedback ? (
        <section className="mt-6">
          <div className="rounded-md border border-[#3a3d3f] bg-[#181a1d] px-5 py-4 text-sm text-[#e5e1d8]">
            {showWindowFeedback}
          </div>
        </section>
      ) : null}

      {controlFeedback ? (
        <section className="mt-6">
          <div className="rounded-md border border-[#3a3d3f] bg-[#181a1d] px-5 py-4 text-sm text-[#e5e1d8]">
            {controlFeedback}
          </div>
        </section>
      ) : null}

      {!openAiStatus.configured || session.status !== "live" ? (
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

          {!openAiStatus.configured ? (
            <StatusNotice
              title="Demo Mode Active"
              body="No OPENAI_API_KEY environment variable is active right now, so the app is using the demo loop fallback instead of real Sora generation."
            />
          ) : null}
        </section>
      ) : null}

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
                  "When a safe crowd remix completes, it will preload here and wait for a manual switch or deck-change auto trigger."
                }
                status={playback?.nextAsset ? "ready to switch" : "open slot"}
              />
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-[#34383c] px-6 py-5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#8f9499]">Live Monitor</p>
              <p className="mt-3 text-sm text-[#aaa79f]">
                Keep an eye on the show here while you test controls. This avoids the extra-tab weirdness from the in-app browser.
              </p>
            </div>

            <div className="aspect-video bg-black">
              <iframe
                key={`${playback?.currentAsset?.id ?? "holding"}-${playback?.nextAsset?.id ?? "none"}`}
                src={cleanShowLink}
                title="Live show monitor"
                className="h-full w-full border-0"
                allow="autoplay; fullscreen; microphone"
              />
            </div>
          </div>

          <div className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#8f9499]">Live Controls</p>
                <p className="mt-3 text-sm text-[#aaa79f]">
                  Manual visual switching, crowd selection, and fallback render controls.
                </p>
              </div>

              {canStartSession ? (
                <button
                  onClick={() => void runControlAction("start-session")}
                  className="rounded-md bg-[#baff39] px-5 py-3 text-sm font-semibold text-[#151515] transition hover:brightness-110"
                >
                  {workingAction === "start-session"
                    ? "Starting..."
                    : session.status === "stopped"
                      ? "Restart Session"
                      : "Start Session"}
                </button>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <ControlButton
                active={workingAction === "pause-selection"}
                label={session.autoSelectEnabled ? "Pause Selection" : "Resume Selection"}
                onClick={() => void runControlAction(session.autoSelectEnabled ? "pause-selection" : "resume-selection")}
              />
              <ControlButton
                active={workingAction === "cut-next"}
                disabled={!playback?.nextAsset}
                label="Hard Cut Next"
                onClick={() => void runControlAction("cut-next")}
              />
              <ControlButton
                active={workingAction === "fade-next"}
                disabled={!playback?.nextAsset}
                label="Fade Next"
                onClick={() => void runControlAction("fade-next")}
              />
              <ControlButton
                active={workingAction === "fallback-remix"}
                label="Fallback Remix"
                onClick={() => void runControlAction("fallback-remix")}
              />
              <ControlButton active={workingAction === "stop-session"} label="Stop Session" onClick={() => void runControlAction("stop-session")} />
            </div>

            <p className="mt-4 text-sm text-[#aaa79f]">
              {playback?.nextAsset
                ? `A ready next loop is loaded. Auto mode is ${audioReactive.sharedState.switchMode === "auto" ? "listening for the next deck change" : "holding for a manual switch"}.`
                : snapshot.queueHealth.waitingOnRender
                  ? "Visual switching will unlock after the current render finishes and loads as the next loop."
                  : "No next loop is ready yet. Queue a fallback remix or wait for a crowd remix to finish."}
            </p>
          </div>

          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Incoming Crowd Prompts</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Audience Requests</h2>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {session.submissions.length === 0 ? (
                <EmptyState
                  title="No audience requests yet"
                  body={
                    session.status === "live"
                      ? "Open the audience form or text the Twilio number to start feeding the remix queue."
                      : "Restart the session first, then new audience requests will appear here in real time."
                  }
                />
              ) : (
                session.submissions.map((submission: any) => (
                  <div key={submission.id} className="rounded-4xl border border-white/10 bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/60">
                          {submission.source}
                        </span>
                        <span className="text-xs uppercase tracking-[0.24em] text-white/40">{submission.status}</span>
                      </div>
                      <span className="text-xs text-white/45">{formatRelativeTime(submission.createdAt)}</span>
                    </div>

                    <p className="mt-4 text-base leading-7 text-white/82">{submission.rawText}</p>

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
          </div>
        </div>

        <div className="space-y-6">
          <AudioReactiveControlsPanel controller={audioReactive} />

          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">OpenAI Environment</p>
            <p className="mt-4 text-sm leading-7 text-white/72">
              {openAiStatus.source === "env"
                ? `Using OPENAI_API_KEY from the local environment${openAiStatus.last4 ? ` ending in ${openAiStatus.last4}` : ""} for moderation and Sora calls.`
                : "No OPENAI_API_KEY environment variable is configured yet, so the app is running in demo fallback mode."}
            </p>
            <div className="mt-5 rounded-3xl border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-white/72">
              Set `OPENAI_API_KEY` in `.env` or your shell before starting the app. The dashboard no longer stores or edits API keys.
            </div>
          </div>

          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Show Links</p>
            <div className="mt-5 space-y-4">
              <button
                onClick={openShowPopout}
                className="block w-full rounded-4xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-plasma/40"
              >
                <p className="text-sm font-semibold text-white">Pop Out Show Window</p>
                <p className="mt-2 text-sm text-white/60">Open the live screen in another tab/window while you stay on the dashboard.</p>
              </button>
              <a
                href={cleanShowLink}
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
                <p className="mt-2 break-all font-mono text-xs text-white/60">{showUrlDisplay || cleanShowLink}</p>
              </div>
              <LinkCard label="Audience Remix Form" href={publicLink} />
              <LinkCard label="Fullscreen Projection View" href={cleanShowLink} />
            </div>
          </div>

          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Render Jobs</p>
            <div className="mt-5 space-y-4">
              {session.renderJobs.length === 0 ? (
                <EmptyState title="No renders yet" body="Start the session to seed the first loop, then new crowd winners will appear here." />
              ) : (
                session.renderJobs.map((job: any) => (
                  <div key={job.id} className="rounded-4xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{job.mode === "seed" ? "Seed Render" : "Crowd Remix"}</p>
                      <span className="text-xs uppercase tracking-[0.24em] text-white/40">{job.status}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/68">{job.promptText}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Session DNA</p>
            <div className="mt-5 space-y-4 text-sm leading-7 text-white/74">
              <div className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3">{session.creativeBible}</div>
              <div className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3">Allowed motifs: {session.allowedMotifs}</div>
              <div className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3">Blocked themes: {session.bannedTerms}</div>
              <div className="rounded-3xl border border-white/10 bg-black/20 px-4 py-3">Motion rules: {session.motionRules}</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8f9499]">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold text-white">{value}</p>
        <p className="text-xs uppercase tracking-[0.12em] text-[#777c82]">{hint}</p>
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
    <div className="border-b border-[#34383c] p-6 last:border-b-0 lg:border-b-0 lg:border-r last:lg:border-r-0">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#8f9499]">{title}</p>
      <p className="mt-4 text-2xl font-semibold text-white">{assetTitle}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[#baff39]">{status}</p>
      <p className="mt-5 text-sm leading-7 text-[#aaa79f]">{prompt}</p>
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
      className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-3 text-sm text-[#e5e1d8] transition hover:border-[#baff39] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {active ? "Working..." : label}
    </button>
  );
}

function LinkCard({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} className="block rounded-md border border-[#34383c] bg-[#111315] p-4 transition hover:border-[#baff39]">
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-2 text-sm text-[#aaa79f]">{href}</p>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#42464a] bg-[#111315] p-5">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-3 text-sm leading-7 text-[#aaa79f]">{body}</p>
    </div>
  );
}

function StatusNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel border border-[#ffb86c]/30 bg-[#2a2018] p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#ffb86c]">{title}</p>
      <p className="mt-3 text-sm leading-7 text-[#e5e1d8]">{body}</p>
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
