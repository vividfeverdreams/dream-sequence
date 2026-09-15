import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPrimarySessionForUser } from "@/lib/session-service";
import { getSessionSnapshot } from "@/lib/snapshot";
import { getOpenAiConnectionStatusForUser } from "@/lib/openai-key-store";
import { createAudioSyncRelayToken } from "@/lib/audio-sync-relay-token";
import { getGoogleConnectionStatusForUser } from "@/lib/google-key-store";
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
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">DREAM SEQUENCE</p>
            <h1 className="mt-4 text-4xl font-semibold text-white">Every story starts somewhere.</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
              Describe the opening scene. Your audience decides what happens next.
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

  const [openAiStatus, googleStatus] = await Promise.all([
    getOpenAiConnectionStatusForUser(user.id),
    getGoogleConnectionStatusForUser(user.id)
  ]);
  const audioSyncRelayToken = createAudioSyncRelayToken(session.id, user.id);

  return (
    <DashboardShell
      initialSnapshot={snapshot}
      currentUserName={user.displayName}
      initialOpenAiStatus={openAiStatus}
      initialGoogleStatus={googleStatus}
      audioSyncRelayToken={audioSyncRelayToken}
    />
  );
}
