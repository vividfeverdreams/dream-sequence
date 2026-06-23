"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type SignupResponse = {
  ok?: boolean;
  email?: string;
  error?: string;
  verificationUrl?: string;
};

export function SignupForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreatedEmail(null);
    setVerificationUrl(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName,
          email,
          password,
          confirmPassword
        })
      });
      const payload = (await response.json().catch(() => null)) as SignupResponse | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to create account.");
        return;
      }

      setCreatedEmail(payload?.email ?? email);
      setVerificationUrl(payload?.verificationUrl ?? null);
    } catch {
      setError("Unable to create account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (createdEmail) {
    return (
      <div className="mx-auto max-w-md">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-plasma">Verify Email</p>
        <h2 className="mt-4 text-3xl font-semibold text-white">Check your inbox.</h2>
        <p className="mt-4 text-sm leading-7 text-white/70">
          We sent a verification link to <span className="text-white">{createdEmail}</span>. Open it to activate the
          account and continue into your dashboard.
        </p>

        {verificationUrl ? (
          <a
            href={verificationUrl}
            className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-plasma/60 bg-plasma/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-plasma/25"
          >
            Open Dev Verification Link
          </a>
        ) : null}

        <Link
          href="/login"
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
        >
          Back To Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">Create Account</p>
      <h2 className="mt-4 text-3xl font-semibold text-white">Start with a verified email.</h2>
      <p className="mt-4 text-sm leading-7 text-white/70">
        Create your DJ account, verify the email, then use the profile page to manage API keys and account settings.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Display Name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-plasma"
            placeholder="Neon Echo"
            autoComplete="name"
          />
        </label>

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
            placeholder="At least 8 characters"
            type="password"
            autoComplete="new-password"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Confirm Password</span>
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-plasma"
            placeholder="Repeat password"
            type="password"
            autoComplete="new-password"
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
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/60">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-white underline decoration-white/30 underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
