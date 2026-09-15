"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const draftStorageKey = "dream-sequence:story-draft";
const durationOptions = [5, 10, 15] as const;
const resolutionOptions = ["480P", "768P", "1080P"] as const;

type StoryForm = {
  basePrompt: string;
  videoDurationSeconds: number;
  videoResolution: (typeof resolutionOptions)[number];
  audienceMode: "web" | "twitch";
};

type TwitchStatus = {
  configured: boolean;
  connected: boolean;
  login?: string | null;
  displayName?: string | null;
  subscriptionStatus?: string | null;
};

const blankForm: StoryForm = {
  basePrompt: "",
  videoDurationSeconds: 5,
  videoResolution: "768P",
  audienceMode: "web"
};

export function SessionSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState<StoryForm>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [twitchStatus, setTwitchStatus] = useState<TwitchStatus | null>(null);
  const [twitchStatusError, setTwitchStatusError] = useState(false);
  const [twitchRefresh, setTwitchRefresh] = useState(0);
  const [disconnectingTwitch, setDisconnectingTwitch] = useState(false);
  const [twitchNotice, setTwitchNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftStorageKey);
      if (saved) {
        const draft = JSON.parse(saved) as Partial<StoryForm>;
        setForm({
          basePrompt: typeof draft.basePrompt === "string" ? draft.basePrompt.slice(0, 1200) : "",
          videoDurationSeconds: durationOptions.includes(draft.videoDurationSeconds as 5 | 10 | 15)
            ? draft.videoDurationSeconds!
            : blankForm.videoDurationSeconds,
          videoResolution: resolutionOptions.includes(draft.videoResolution!)
            ? draft.videoResolution!
            : blankForm.videoResolution,
          audienceMode: draft.audienceMode === "twitch" ? "twitch" : "web"
        });
        window.sessionStorage.removeItem(draftStorageKey);
      }
    } catch {
      // A draft is optional when browser storage is unavailable.
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("twitch") === "error") {
      setError(params.get("twitchError") || "Twitch could not connect. Try connecting again to use chat for this story.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTwitchStatusError(false);
    void fetch("/api/twitch/status", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check Twitch connection.");
        return response.json() as Promise<TwitchStatus>;
      })
      .then(setTwitchStatus)
      .catch(() => {
        if (!controller.signal.aborted) setTwitchStatusError(true);
      });
    return () => controller.abort();
  }, [twitchRefresh]);

  useEffect(() => {
    if (!twitchStatus?.subscriptionStatus || !["pending", "webhook_callback_verification_pending"].includes(twitchStatus.subscriptionStatus)) return;
    const timer = window.setTimeout(() => setTwitchRefresh((value) => value + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [twitchStatus]);

  function connectTwitch() {
    try {
      window.sessionStorage.setItem(draftStorageKey, JSON.stringify(form));
    } catch {
      setError("Your browser could not save this story before connecting Twitch. Allow browser storage, then try again.");
      return;
    }
    window.location.assign("/api/twitch/connect?returnTo=/dashboard/new");
  }

  async function disconnectTwitch() {
    setDisconnectingTwitch(true);
    setError(null);
    try {
      const response = await fetch("/api/twitch/disconnect", { method: "POST" });
      const payload = await response.json().catch(() => null) as { error?: string; revokeAtTwitch?: boolean } | null;
      if (!response.ok) throw new Error(payload?.error || "Twitch could not disconnect. Please try again.");
      setTwitchStatus((current) => current ? { ...current, connected: false, login: null, displayName: null, subscriptionStatus: null } : null);
      setTwitchNotice(payload?.revokeAtTwitch
        ? "Chat intake has stopped. Also remove Dream Sequence from Twitch Settings → Connections to finish revoking access."
        : "Twitch disconnected.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Twitch could not disconnect. Please try again.");
    } finally {
      setDisconnectingTwitch(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!form.basePrompt.trim()) {
      setError("Tell us how your story begins.");
      return;
    }
    if (form.audienceMode === "twitch" && !twitchStatus?.connected) {
      setError("Connect your Twitch account to collect story ideas from chat.");
      return;
    }
    setIsCreating(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, basePrompt: form.basePrompt.trim() })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Could not create your story. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel overflow-hidden" aria-busy={isCreating}>
      <div className="bg-aurora px-6 py-8 sm:px-8 sm:py-10">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-plasma">The first scene is yours</p>
        <label className="mt-4 block">
          <span className="block text-2xl font-semibold text-white sm:text-3xl">How does your story begin?</span>
          <span id="story-prompt-help" className="mt-3 block max-w-2xl text-sm leading-7 text-white/65">
            Set the scene, introduce a character, or start with something impossible. Your audience decides what happens next.
          </span>
          <textarea
            autoFocus
            required
            name="basePrompt"
            maxLength={1200}
            rows={5}
            value={form.basePrompt}
            disabled={isCreating}
            onChange={(event) => setForm((current) => ({ ...current, basePrompt: event.target.value }))}
            aria-describedby="story-prompt-help"
            className="mt-6 min-h-44 w-full resize-y rounded-3xl border border-white/15 bg-black/40 px-5 py-4 text-base leading-7 outline-none transition placeholder:text-white/35 focus:border-plasma disabled:opacity-60 sm:text-lg"
            placeholder="A lone astronaut discovers a glowing door in the middle of a desert. As she reaches for it, the sand begins to float…"
          />
        </label>
        <p className="mt-2 text-right font-mono text-xs text-white/35">{form.basePrompt.length} / 1200</p>
      </div>

      <div className="space-y-7 border-t border-white/10 px-6 py-7 sm:px-8">
        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset disabled={isCreating}>
            <legend className="text-sm font-medium text-white/85">Clip length</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {durationOptions.map((duration) => (
                <Choice key={duration} name="videoDurationSeconds" value={String(duration)} checked={form.videoDurationSeconds === duration} onChange={() => setForm((current) => ({ ...current, videoDurationSeconds: duration }))}>
                  {duration} sec
                </Choice>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={isCreating}>
            <legend className="text-sm font-medium text-white/85">Visual quality</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {resolutionOptions.map((resolution) => (
                <Choice key={resolution} name="videoResolution" value={resolution} checked={form.videoResolution === resolution} onChange={() => setForm((current) => ({ ...current, videoResolution: resolution }))}>
                  {resolution.toLowerCase()}
                </Choice>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset disabled={isCreating}>
          <legend className="text-sm font-medium text-white/85">Where does the audience join in?</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Choice name="audienceMode" value="web" checked={form.audienceMode === "web"} onChange={() => setForm((current) => ({ ...current, audienceMode: "web" }))}>
              <span className="block">QR code</span>
              <span className="mt-1 block text-xs font-normal leading-5 text-white/55">Scan the screen and type the next part.</span>
            </Choice>
            <Choice name="audienceMode" value="twitch" checked={form.audienceMode === "twitch"} onChange={() => setForm((current) => ({ ...current, audienceMode: "twitch" }))}>
              <span className="block">Twitch mode</span>
              <span className="mt-1 block text-xs font-normal leading-5 text-white/55">Let your Twitch chat continue the story.</span>
            </Choice>
          </div>
        </fieldset>

        {form.audienceMode === "twitch" ? (
          <div className="rounded-3xl border border-violet-300/20 bg-violet-400/[0.06] p-5" aria-live="polite">
            {twitchStatusError ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white/70">We couldn&apos;t check your Twitch connection.</p>
                <button type="button" onClick={() => setTwitchRefresh((value) => value + 1)} className="rounded-full border border-white/20 px-4 py-2 text-sm">Try again</button>
              </div>
            ) : !twitchStatus ? (
              <p className="text-sm text-white/70">Checking Twitch connection…</p>
            ) : !twitchStatus.configured ? (
              <p className="text-sm leading-6 text-white/70">Twitch connections haven&apos;t been enabled on this platform yet. You can use QR code mode now.</p>
            ) : twitchStatus.subscriptionStatus && ["pending", "webhook_callback_verification_pending"].includes(twitchStatus.subscriptionStatus) ? (
              <p className="text-sm leading-6 text-white/70">Twitch is verifying your channel connection…</p>
            ) : twitchStatus.connected ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">Connected to {twitchStatus.displayName || twitchStatus.login || "Twitch"}</p>
                  <button type="button" disabled={disconnectingTwitch || isCreating} onClick={() => void disconnectTwitch()} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/65 transition hover:bg-white/5 disabled:opacity-50">{disconnectingTwitch ? "Disconnecting…" : "Disconnect"}</button>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/65">Viewers type <span className="font-mono text-violet-200">!next followed by their idea</span> in your chat. Approved ideas join the story queue while your show is live.</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="max-w-md text-sm leading-6 text-white/70">Connect your channel, then viewers can send <span className="font-mono text-violet-200">!next</span> with their idea in chat.</p>
                <button type="button" onClick={connectTwitch} className="rounded-full bg-violet-400 px-5 py-3 text-sm font-semibold text-ink">Connect Twitch</button>
              </div>
            )}
          </div>
        ) : null}

        {form.audienceMode === "twitch" && twitchNotice ? <p role="status" className="text-sm leading-6 text-white/65">{twitchNotice}</p> : null}
        <p className="text-sm leading-6 text-white/50">Powered by H3 Max. Every new scene begins from the previous clip&apos;s last frame.</p>
        {error ? <p role="alert" className="rounded-3xl border border-ember/25 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</p> : null}
        <button type="submit" disabled={isCreating || disconnectingTwitch || (form.audienceMode === "twitch" && !twitchStatus?.connected)} className="w-full rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-48">
          {isCreating ? "Creating your space…" : "Create my story space"}
        </button>
      </div>
    </form>
  );
}

function Choice({ name, value, checked, onChange, children }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className={`block cursor-pointer rounded-2xl border px-4 py-3 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-plasma ${checked ? "border-plasma/60 bg-plasma/10 text-white" : "border-white/10 bg-black/20 text-white/65 hover:border-white/25"}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}
