import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPrimarySessionForUser } from "@/lib/session-service";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SessionsPageProps = {
  searchParams?: Promise<{
    verified?: string | string[];
  }>;
};

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const user = await requireUser();
  const latestSession = await getPrimarySessionForUser(user.id);
  const params = searchParams ? await searchParams : {};
  const verified = Array.isArray(params.verified) ? params.verified[0] : params.verified;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">Session Launch</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">Pick up the room or build a fresh one.</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
            Signed in as {user.displayName}. Continue opens the newest session for this account; new session starts from editable setup.
          </p>
        </div>

        <Link href="/" className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-plasma">
          Back Home
        </Link>
      </header>

      {verified === "1" ? (
        <div className="mt-8 rounded-md border border-[#baff39]/35 bg-[#baff39]/10 px-4 py-3 text-sm font-medium text-[#f1ffd5]">
          Email verified. Your account is ready.
        </div>
      ) : null}

      <section className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="panel p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8f9499]">Continue</p>
          <h2 className="mt-4 text-2xl font-semibold text-white">Continue Last Session</h2>
          {latestSession ? (
            <>
              <div className="mt-5 space-y-3 text-sm leading-7 text-[#c9c7bd]">
                <p className="text-lg font-semibold text-white">{latestSession.name}</p>
                <p>
                  {latestSession.artistName} - {latestSession.trackName}
                </p>
                <p>Status: {latestSession.status}</p>
                <p>Created {formatRelativeTime(latestSession.createdAt)}</p>
              </div>
              <Link
                href="/dashboard"
                className="mt-7 inline-flex rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
              >
                Continue Session
              </Link>
            </>
          ) : (
            <>
              <p className="mt-5 text-sm leading-7 text-[#aaa79f]">
                This account does not have a session yet, so there is nothing to resume.
              </p>
              <span className="mt-7 inline-flex cursor-not-allowed rounded-md border border-[#42464a] px-5 py-3 text-sm text-white/45">
                Continue Unavailable
              </span>
            </>
          )}
        </div>

        <div className="panel p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8f9499]">Create</p>
          <h2 className="mt-4 text-2xl font-semibold text-white">Start New Session</h2>
          <p className="mt-5 text-sm leading-7 text-[#aaa79f]">
            Configure the session identity, visual DNA, base render prompt, audience instructions, system prompt, automoderation prompt,
            remix template, negative prompt, and queue automation.
          </p>
          <Link
            href="/sessions/new"
            className="mt-7 inline-flex rounded-md bg-[#baff39] px-5 py-3 text-sm font-semibold text-[#151515] transition hover:brightness-110"
          >
            Start New Session
          </Link>
        </div>
      </section>
    </main>
  );
}
