"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("dj@example.com");
  const [password, setPassword] = useState("crowdremix-demo");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
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

    startTransition(() => {
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="font-mono text-xs uppercase tracking-[0.32em] text-white/45">Demo Credentials Preloaded</p>
      <h2 className="mt-4 text-3xl font-semibold text-white">Open the control deck.</h2>
      <p className="mt-4 text-sm leading-7 text-white/70">
        The seed script creates a demo DJ account with the fields already filled here. You can change them anytime.
      </p>

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

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
