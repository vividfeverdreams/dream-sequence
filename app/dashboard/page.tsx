import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPrimarySessionForUser } from "@/lib/session-service";
import { getSessionSnapshot } from "@/lib/snapshot";
import { getOpenAiConnectionStatusForUser } from "@/lib/openai-key-store";
import { SessionSetupForm } from "@/components/session-setup-form";
import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const session = await getPrimarySessionForUser(user.id);

  if (!session) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">Crowd Remix</p>
            <h1 className="mt-4 text-4xl font-semibold text-white">Set up your first live session.</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
              Create the visual DNA once, then let SMS and QR prompts remix the show inside those boundaries.
            </p>
          </div>

          <Link href="/" className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10">
            Back Home
          </Link>
        </header>

        <section className="mt-10">
          <SessionSetupForm />
        </section>
      </main>
    );
  }

  const snapshot = await getSessionSnapshot(session.id);

  if (!snapshot) {
    return null;
  }

  const openAiStatus = await getOpenAiConnectionStatusForUser(user.id);

  return (
    <DashboardShell
      initialSnapshot={snapshot}
      currentUserName={user.displayName}
      initialOpenAiStatus={openAiStatus}
    />
  );
}
