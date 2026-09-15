"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { PublicSubmissionStatus } from "@/lib/public-submission-status";

type PublicSubmissionFormProps = {
  sessionCode: string;
  disabled?: boolean;
  disabledMessage?: string | null;
};

type TrackedSubmissionStatus = PublicSubmissionStatus;

const terminalStates = new Set<TrackedSubmissionStatus["state"]>([
  "banned", "blocked", "failed", "live", "played", "provider-blocked", "rejected"
]);
const participantDeviceStorageKey = "dream-sequence:participant-device";
const participantNicknameStorageKey = "dream-sequence:participant-nickname";

type SubmissionResponse = {
  message?: string;
  error?: string;
  status?: string;
  submissionId?: string;
  moderationBlockCount?: number;
  prompt?: string;
};

export function PublicSubmissionForm({ sessionCode, disabled = false, disabledMessage = null }: PublicSubmissionFormProps) {
  const [prompt, setPrompt] = useState("");
  const [nickname, setNickname] = useState("");
  const [participantToken, setParticipantToken] = useState("");
  const [identityReady, setIdentityReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [trackedSubmissionId, setTrackedSubmissionId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<TrackedSubmissionStatus | null>(null);
  const activeSubmissionId = useRef<string | null>(null);
  const participantBanned = trackedStatus?.state === "banned";
  const formDisabled = disabled || participantBanned || submitting;

  useEffect(() => {
    const savedNickname = readParticipantStorage(participantNicknameStorageKey)?.trim() ?? "";
    const savedToken = readParticipantStorage(participantDeviceStorageKey)?.trim() ?? "";
    const deviceToken = savedToken.length >= 16 ? savedToken : createParticipantDeviceToken();
    writeParticipantStorage(participantDeviceStorageKey, deviceToken);
    setParticipantToken(deviceToken);
    setNickname(savedNickname);
    setIdentityReady(true);
  }, []);

  useEffect(() => {
    if (!trackedSubmissionId || !trackedStatus || terminalStates.has(trackedStatus.state)) return;
    const controller = new AbortController();
    let inFlight = false;
    const interval = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/r/${sessionCode}?submissionId=${encodeURIComponent(trackedSubmissionId)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Status unavailable");
        const payload = (await response.json()) as TrackedSubmissionStatus;
        if (!controller.signal.aborted && activeSubmissionId.current === trackedSubmissionId) {
          setTrackedStatus(payload);
          setMessage(null);
        }
      } catch {
        if (!controller.signal.aborted && activeSubmissionId.current === trackedSubmissionId) {
          setMessage("Your idea was received. The live tracker will try again shortly.");
        }
      } finally {
        inFlight = false;
      }
    }, 4000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [sessionCode, trackedSubmissionId, trackedStatus?.state]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) {
      setMessage(disabledMessage ?? "The story is not accepting ideas right now.");
      return;
    }
    if (participantBanned) {
      setMessage("This device is locked out for the rest of this live story.");
      return;
    }
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt) {
      setMessage("Tell us what happens next.");
      return;
    }
    const submittedNickname = nickname.trim() || "Guest";
    const token = participantToken || createParticipantDeviceToken();
    writeParticipantStorage(participantNicknameStorageKey, nickname.trim());
    writeParticipantStorage(participantDeviceStorageKey, token);
    setParticipantToken(token);
    setSubmitting(true);
    setMessage(null);
    activeSubmissionId.current = null;
    setTrackedSubmissionId(null);
    setTrackedStatus(null);
    try {
      const response = await fetch(`/api/r/${sessionCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt, senderLabel: submittedNickname, participantToken: token })
      });
      const payload = (await response.json().catch(() => null)) as SubmissionResponse | null;
      const receipt = getPublicSubmissionReceipt(response.ok, payload, submittedPrompt);
      if (!receipt.received) {
        setTrackedStatus(receipt.trackedStatus);
        setMessage(receipt.message);
        return;
      }
      setPrompt("");
      setTrackedStatus(receipt.trackedStatus);
      activeSubmissionId.current = receipt.submissionId;
      setTrackedSubmissionId(receipt.submissionId);
    } catch {
      setMessage("Could not reach the story queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-busy={submitting}>
      <label className="block">
        <span className="block text-3xl font-semibold leading-tight text-white sm:text-4xl">What happens next?</span>
        <span id="continuation-help" className="mt-3 block text-sm leading-7 text-white/65">A twist, a new character, a whole new world. Write the next moment in the story.</span>
        <textarea
          required
          name="prompt"
          maxLength={1200}
          rows={5}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={formDisabled}
          aria-describedby="continuation-help"
          placeholder="The door opens onto an ocean of stars, and something on the other side calls her name…"
          className="mt-5 min-h-44 w-full resize-y rounded-3xl border border-white/15 bg-black/30 px-5 py-4 text-base leading-7 outline-none transition placeholder:text-white/30 focus:border-plasma disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="mt-2 block text-right font-mono text-xs text-white/35">{prompt.length} / 1200</span>
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-white/75">Nickname <span className="font-normal text-white/40">(optional)</span></span>
        <input
          type="text"
          name="senderLabel"
          minLength={2}
          maxLength={24}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          disabled={formDisabled}
          autoComplete="nickname"
          className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-3 outline-none transition placeholder:text-white/30 focus:border-plasma disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Your name on the screen, or leave blank"
        />
      </label>
      <button type="submit" disabled={formDisabled || !identityReady || !prompt.trim()} className="w-full rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
        {disabled ? "Story paused" : participantBanned ? "Device locked for this story" : submitting ? "Sending…" : "Send what happens next"}
      </button>
      {message ? <p className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80" role="status" aria-live="polite">{message}</p> : null}
      {trackedStatus ? (
        <div className="rounded-3xl border border-white/10 bg-black/20 p-5" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/45">Your story idea</p>
            <span className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${getStatusChipClassName(trackedStatus.state)}`}>{trackedStatus.state}</span>
          </div>
          <p className="mt-4 text-lg font-semibold text-white">{trackedStatus.title}</p>
          <p className="mt-2 text-sm leading-7 text-white/70">{trackedStatus.detail}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {renderSubmissionSteps(trackedStatus.state).map((step) => (
              <span key={step.label} className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.15em] ${step.active ? "border-plasma/45 bg-plasma/10 text-plasma" : "border-white/10 text-white/35"}`}>{step.label}</span>
            ))}
          </div>
          <p className="mt-4 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/75">{trackedStatus.prompt}</p>
        </div>
      ) : null}
    </form>
  );
}

export function getPublicSubmissionReceipt(
  responseOk: boolean,
  payload: SubmissionResponse | null,
  submittedPrompt: string
):
  | { received: true; submissionId: string; trackedStatus: TrackedSubmissionStatus }
  | { received: false; message: string; trackedStatus: TrackedSubmissionStatus | null } {
  if (!responseOk || payload?.status === "banned" || payload?.status === "rate-limited") {
    return {
      received: false,
      message: payload?.error ?? payload?.message ?? "Could not submit that idea.",
      trackedStatus: payload?.status === "banned"
        ? createBannedTrackedStatus(payload.prompt ?? submittedPrompt, payload)
        : null
    };
  }

  const submissionId = payload?.submissionId?.trim();
  if (!submissionId || (payload?.status !== "approved" && payload?.status !== "rejected")) {
    return {
      received: false,
      message: "The story queue did not confirm receipt. Your idea is still here; please try again.",
      trackedStatus: null
    };
  }

  return {
    received: true,
    submissionId,
    trackedStatus: createFallbackTrackedStatus(payload.prompt ?? submittedPrompt, payload)
  };
}

function createFallbackTrackedStatus(
  prompt: string,
  fallback?: {
    message?: string;
    status?: string;
  } | null
): TrackedSubmissionStatus {
  if (fallback?.status === "rejected") {
    return {
      state: "rejected",
      title: "Not approved for the queue",
      detail: fallback.message ?? "The venue-safe filter rejected this idea.",
      prompt,
      submittedAt: "",
      updatedAt: ""
    };
  }

  return {
    state: "approved",
    title: "Received by the queue",
    detail: fallback?.message ?? "Your idea is in the story queue.",
    prompt,
    submittedAt: "",
    updatedAt: ""
  };
}

function createBannedTrackedStatus(
  prompt: string,
  payload?: {
    error?: string;
    message?: string;
    moderationBlockCount?: number;
  } | null
): TrackedSubmissionStatus {
  return {
    state: "banned",
    title: "Device locked for this sequence",
    detail:
      payload?.error ??
      payload?.message ??
      "This device is locked out until the live story ends.",
    prompt,
    moderationBlockCount: payload?.moderationBlockCount ?? 3,
    blocksRemaining: 0,
    submittedAt: "",
    updatedAt: ""
  };
}

function renderSubmissionSteps(state: TrackedSubmissionStatus["state"]) {
  const activeIndex = (() => {
    switch (state) {
      case "submitted":
        return 0;
      case "approved":
      case "retrying":
      case "failed":
      case "blocked":
      case "banned":
      case "provider-blocked":
      case "rejected":
        return 1;
      case "queued":
        return 2;
      case "rendering":
        return 3;
      case "ready":
        return 4;
      case "live":
      case "played":
        return 5;
      default:
        return 0;
    }
  })();

  return ["Received", "Approved", "Queued", "Rendering", "Ready", "Live"].map((label, index) => ({
    label,
    active: index <= activeIndex
  }));
}

function getStatusChipClassName(state: TrackedSubmissionStatus["state"]) {
  switch (state) {
    case "live":
      return "border border-plasma/45 bg-plasma/12 text-plasma";
    case "ready":
    case "rendering":
    case "queued":
    case "approved":
    case "retrying":
    case "submitted":
      return "border border-white/10 bg-white/[0.03] text-white/72";
    case "played":
      return "border border-white/10 bg-white/[0.03] text-white/55";
    case "rejected":
    case "failed":
    case "blocked":
    case "banned":
    case "provider-blocked":
      return "border border-ember/35 bg-ember/12 text-ember";
    default:
      return "border border-white/10 bg-white/[0.03] text-white/72";
  }
}

function createParticipantDeviceToken() {
  if (typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readParticipantStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeParticipantStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing can disable storage; the in-memory identity still works for this page load.
  }
}
