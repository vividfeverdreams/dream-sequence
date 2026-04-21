"use client";

import { FormEvent, useEffect, useState } from "react";

type PublicSubmissionFormProps = {
  sessionCode: string;
  disabled?: boolean;
  disabledMessage?: string | null;
};

type TrackedSubmissionStatus = {
  state: "approved" | "queued" | "rendering" | "ready" | "live" | "played" | "rejected" | "retrying" | "submitted";
  title: string;
  detail: string;
  prompt: string;
  submittedAt: string;
  updatedAt: string;
};

const terminalStates = new Set<TrackedSubmissionStatus["state"]>(["live", "played", "rejected"]);

export function PublicSubmissionForm({
  sessionCode,
  disabled = false,
  disabledMessage = null
}: PublicSubmissionFormProps) {
  const [prompt, setPrompt] = useState("");
  const [senderLabel, setSenderLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [trackedSubmissionId, setTrackedSubmissionId] = useState<string | null>(null);
  const [trackedStatus, setTrackedStatus] = useState<TrackedSubmissionStatus | null>(null);

  useEffect(() => {
    if (!trackedSubmissionId || !trackedStatus || terminalStates.has(trackedStatus.state)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTrackedStatus(trackedSubmissionId);
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, [trackedSubmissionId, trackedStatus]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      setMessage(disabledMessage ?? "The remix queue is not accepting submissions right now.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setTrackedSubmissionId(null);
    setTrackedStatus(null);

    try {
      const response = await fetch(`/api/r/${sessionCode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt,
          senderLabel
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            error?: string;
            status?: string;
            submissionId?: string;
          }
        | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Could not submit that remix.");
        return;
      }

      setPrompt("");

      if (payload?.submissionId) {
        setTrackedSubmissionId(payload.submissionId);
        await refreshTrackedStatus(payload.submissionId, payload);
      } else {
        setMessage(payload?.message ?? "Your remix is in the mix.");
      }
    } catch {
      setMessage("Could not reach the remix queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshTrackedStatus(
    submissionId: string,
    fallback?: {
      message?: string;
      status?: string;
    } | null
  ) {
    try {
      const response = await fetch(`/api/r/${sessionCode}?submissionId=${encodeURIComponent(submissionId)}`);

      if (!response.ok) {
        throw new Error("Could not load the latest remix status.");
      }

      const payload = (await response.json()) as TrackedSubmissionStatus;
      setTrackedStatus(payload);
      setMessage(null);
    } catch {
      if (fallback) {
        setTrackedStatus(createFallbackTrackedStatus(prompt, fallback));
        setMessage(fallback.message ?? "Your remix is in the mix.");
        return;
      }

      setMessage("We received your remix, but the live tracker could not refresh right now.");
    }
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">One change at a time</p>
      <p className="mt-3 text-sm leading-7 text-white/68">
        After you send a remix, stay on this page and we will keep tracking what happens to it.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/82">Optional name</span>
          <input
            value={senderLabel}
            onChange={(event) => setSenderLabel(event.target.value)}
            disabled={disabled}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
            placeholder="Skyline crew"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/82">Your remix idea</span>
          <textarea
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={disabled}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
            placeholder="Turn the chrome tunnel into a coral pulse with slower breathing light and a glass ripple on every beat phrase."
          />
        </label>

        {message ? <p className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">{message}</p> : null}

        {trackedStatus ? (
          <div className="rounded-4xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Latest Remix Status</p>
              <span className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${getStatusChipClassName(trackedStatus.state)}`}>
                {trackedStatus.state}
              </span>
            </div>

            <p className="mt-4 text-lg font-semibold text-white">{trackedStatus.title}</p>
            <p className="mt-3 text-sm leading-7 text-white/72">{trackedStatus.detail}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {renderSubmissionSteps(trackedStatus.state).map((step) => (
                <span
                  key={step.label}
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${
                    step.active
                      ? "border-plasma/45 bg-plasma/12 text-plasma"
                      : "border-white/10 bg-white/[0.03] text-white/42"
                  }`}
                >
                  {step.label}
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-white/45">Submitted Prompt</p>
              <p className="mt-2 text-sm leading-6 text-white/75">{trackedStatus.prompt}</p>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || disabled}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {disabled ? "Queue Offline" : submitting ? "Sending..." : "Send Remix"}
        </button>
      </form>
    </div>
  );
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
      detail: fallback.message ?? "The venue-safe filter rejected this remix.",
      prompt,
      submittedAt: "",
      updatedAt: ""
    };
  }

  return {
    state: "approved",
    title: "Received by the queue",
    detail: fallback?.message ?? "Your remix is in the mix.",
    prompt,
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
      return "border border-ember/35 bg-ember/12 text-ember";
    default:
      return "border border-white/10 bg-white/[0.03] text-white/72";
  }
}
