"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to sign in.");
        return;
      }

      // Force a full navigation so the freshly set auth cookie is picked up reliably.
      window.location.assign("/dashboard");
    } catch {
      setError("Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">DJ Login</p>
      <h2 className="mt-4 text-3xl font-semibold text-white">Open the control deck.</h2>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-plasma"
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Password</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-plasma"
            type="password"
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <div className="rounded-3xl border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
