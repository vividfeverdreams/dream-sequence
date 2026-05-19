"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type LoginFormProps = {
  redirectTo?: string;
  notice?: string | null;
};

type LoginResponse = {
  error?: string;
  code?: string;
};

type ResendVerificationResponse = {
  error?: string;
  verificationUrl?: string;
};

export function LoginForm({ redirectTo = "/sessions", notice = null }: LoginFormProps) {
  const [email, setEmail] = useState("dj@example.com");
  const [password, setPassword] = useState("crowdremix-demo");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendMessage(null);
    setVerificationUrl(null);
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
        const payload = (await response.json().catch(() => null)) as LoginResponse | null;
        setError(payload?.error ?? "Unable to sign in.");
        setNeedsVerification(payload?.code === "EMAIL_UNVERIFIED");
        return;
      }

      // Force a full navigation so the freshly set auth cookie is picked up reliably.
      window.location.assign(redirectTo);
    } catch {
      setError("Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendVerification() {
    setIsResending(true);
    setResendMessage(null);
    setVerificationUrl(null);

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email
        })
      });
      const payload = (await response.json().catch(() => null)) as ResendVerificationResponse | null;

      if (!response.ok) {
        setResendMessage(payload?.error ?? "Unable to send verification email.");
        return;
      }

      setResendMessage("Verification email sent. Check your inbox.");
      setVerificationUrl(payload?.verificationUrl ?? null);
    } catch {
      setResendMessage("Unable to send verification email.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">Demo Credentials Preloaded</p>
      <h2 className="mt-4 text-3xl font-semibold text-white">Open the control deck.</h2>
      <p className="mt-4 text-sm leading-7 text-white/70">
        The seed script creates a demo DJ account with the fields already filled here. You can change them anytime.
      </p>

      {notice ? (
        <div className="mt-6 rounded-3xl border border-plasma/25 bg-plasma/10 px-4 py-3 text-sm text-white">
          {notice}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/80">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-3xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-plasma"
            placeholder="dj@example.com"
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
            placeholder="crowdremix-demo"
            type="password"
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <div className="rounded-3xl border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</div>
        ) : null}

        {needsVerification ? (
          <div className="space-y-3 rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
            <p className="text-sm text-white/70">Need a fresh verification link?</p>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isResending}
              className="w-full rounded-full border border-white/15 px-5 py-2 text-sm font-semibold text-white transition hover:border-plasma/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResending ? "Sending..." : "Resend Verification Email"}
            </button>
            {resendMessage ? <p className="text-sm text-white/70">{resendMessage}</p> : null}
            {verificationUrl ? (
              <a
                href={verificationUrl}
                className="inline-flex w-full items-center justify-center rounded-full border border-plasma/60 bg-plasma/15 px-5 py-2 text-sm font-semibold text-white transition hover:bg-plasma/25"
              >
                Open Dev Verification Link
              </a>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing In..." : "Sign In"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/60">
        Need an account?{" "}
        <Link href="/signup" className="font-semibold text-white underline decoration-white/30 underline-offset-4">
          Create one
        </Link>
      </p>
    </div>
  );
}
