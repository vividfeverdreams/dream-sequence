"use client";

import { FormEvent, useState } from "react";

type PublicSubmissionFormProps = {
  sessionCode: string;
};

export function PublicSubmissionForm({ sessionCode }: PublicSubmissionFormProps) {
  const [prompt, setPrompt] = useState("");
  const [senderLabel, setSenderLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

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

    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    setSubmitting(false);

    if (!response.ok) {
      setMessage(payload?.error ?? "Could not submit that remix.");
      return;
    }

    setPrompt("");
    setMessage(payload?.message ?? "Your remix is in the mix.");
  }

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">One change at a time</p>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/82">Optional name</span>
          <input
            value={senderLabel}
            onChange={(event) => setSenderLabel(event.target.value)}
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
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-plasma"
            placeholder="Turn the chrome tunnel into a coral pulse with slower breathing light and a glass ripple on every beat phrase."
          />
        </label>

        {message ? <p className="rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/80">{message}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Sending..." : "Send Remix"}
        </button>
      </form>
    </div>
  );
}
