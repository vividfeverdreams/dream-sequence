"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { SessionSnapshot } from "@/lib/snapshot";
import { formatRelativeTime } from "@/lib/utils";

type DashboardShellProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  currentUserName: string;
};

export function DashboardShell({ initialSnapshot, currentUserName }: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const deferredSnapshot = useDeferredValue(snapshot);

  const session = deferredSnapshot.session;
  const playback = session.playbackState;
  const publicLink = `/r/${session.code}`;
  const showLink = `/show/${session.id}`;

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

  async function runControlAction(action: string) {
    setWorkingAction(action);

    try {
      if (action === "start-session") {
        await fetch(`/api/sessions/${session.id}/start`, {
          method: "POST"
        });
      } else if (action === "logout") {
        await fetch("/api/auth/logout", {
          method: "POST"
        });
        window.location.href = "/login";
        return;
      } else {
        await fetch(`/api/sessions/${session.id}/control`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action
          })
        });
      }
    } finally {
      setWorkingAction(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">DJ Dashboard</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">{session.name}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-white/70">
            {session.artistName} - {session.trackName}. {currentUserName}, this control view keeps the queue moving while the current loop stays protected on screen.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a href={publicLink} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10">
            Audience Form
          </a>
          <a href={showLink} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10">
            Fullscreen Show
          </a>
          <button
            onClick={() => void runControlAction("logout")}
            className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
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
                  "When a safe crowd remix completes, it will preload here and crossfade into the show."
                }
                status={playback?.nextAsset ? "ready to fade" : "open slot"}
              />
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Live Controls</p>
                <p className="mt-3 text-sm text-white/68">
                  Keep the floor safe, pause automation if needed, and trigger a backup remix when the queue gets weird.
                </p>
              </div>

              {session.status === "draft" ? (
                <button
                  onClick={() => void runControlAction("start-session")}
                  className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
                >
                  {workingAction === "start-session" ? "Starting..." : "Start Session"}
                </button>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <ControlButton
                active={workingAction === "pause-selection"}
                label={session.autoSelectEnabled ? "Pause Selection" : "Resume Selection"}
                onClick={() => void runControlAction(session.autoSelectEnabled ? "pause-selection" : "resume-selection")}
              />
              <ControlButton active={workingAction === "skip-next"} label="Skip To Next" onClick={() => void runControlAction("skip-next")} />
              <ControlButton
                active={workingAction === "fallback-remix"}
                label="Fallback Remix"
                onClick={() => void runControlAction("fallback-remix")}
              />
              <ControlButton active={workingAction === "stop-session"} label="Stop Session" onClick={() => void runControlAction("stop-session")} />
            </div>
          </div>

          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Incoming Crowd Prompts</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Ranked queue feed</h2>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {session.submissions.length === 0 ? (
                <EmptyState
                  title="No crowd prompts yet"
                  body="Open the audience form or text the Twilio number to start feeding the remix queue."
                />
              ) : (
                session.submissions.map((submission) => (
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
          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Show Links</p>
            <div className="mt-5 space-y-4">
              <LinkCard label="Audience Remix Form" href={publicLink} />
              <LinkCard label="Fullscreen Projection View" href={showLink} />
            </div>
          </div>

          <div className="panel p-6">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/45">Render Jobs</p>
            <div className="mt-5 space-y-4">
              {session.renderJobs.length === 0 ? (
                <EmptyState title="No renders yet" body="Start the session to seed the first loop, then new crowd winners will appear here." />
              ) : (
                session.renderJobs.map((job) => (
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

function ControlButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/82 transition hover:bg-white/[0.08]"
    >
      {active ? "Working..." : label}
    </button>
  );
}

function LinkCard({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block rounded-4xl border border-white/10 bg-black/20 p-4 transition hover:border-plasma/40">
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className="mt-2 text-sm text-white/60">{href}</p>
    </a>
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
