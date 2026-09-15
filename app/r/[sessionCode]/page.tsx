import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PublicSubmissionForm } from "@/components/public-submission-form";

export const dynamic = "force-dynamic";

type PublicRouteProps = {
  params: Promise<{ sessionCode: string }>;
};

export default async function PublicSubmissionPage({ params }: PublicRouteProps) {
  const { sessionCode } = await params;
  const session = await db.dJSession.findUnique({ where: { code: sessionCode } });
  if (!session) notFound();

  const intakeDisabled = session.status !== "live";
  const intakeMessage = session.status === "stopped"
    ? "This story is paused. You can send the next idea when the host restarts the show."
    : "The story hasn't started yet. You can send your idea once the host starts the show.";
  const twitchMode = session.audienceMode === "twitch";
  const twitchUrl = session.twitchChannel ? `https://www.twitch.tv/${encodeURIComponent(session.twitchChannel)}` : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-8 sm:px-6 sm:py-12">
      <div className="panel w-full overflow-hidden">
        <div className="border-b border-white/10 bg-aurora px-6 py-7 sm:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">DREAM SEQUENCE</p>
          <p className="mt-4 text-lg font-semibold text-white">{session.name}</p>
          <p className="mt-2 text-sm leading-7 text-white/65">One story. Everyone has a part in it.</p>
        </div>
        <div className="space-y-5 px-6 py-8 sm:px-8">
          {intakeDisabled ? (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] px-5 py-4" role="status">
              <p className="text-sm leading-7 text-white/75">{intakeMessage}</p>
            </div>
          ) : null}
          {twitchMode ? (
            <div>
              <h1 className="text-3xl font-semibold text-white">What happens next?</h1>
              <p className="mt-4 text-sm leading-7 text-white/70">This story takes ideas from Twitch chat. Type <span className="font-mono text-plasma">!next</span> followed by your idea in {session.twitchChannel ? `${session.twitchChannel}'s` : "the host's"} chat to join in.</p>
              {twitchUrl ? <a href={twitchUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90">Open Twitch chat</a> : null}
            </div>
          ) : (
            <PublicSubmissionForm sessionCode={session.code} disabled={intakeDisabled} disabledMessage={intakeMessage} />
          )}
        </div>
      </div>
    </main>
  );
}
