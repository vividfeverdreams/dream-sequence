import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PublicSubmissionForm } from "@/components/public-submission-form";

export const dynamic = "force-dynamic";

type PublicRouteProps = {
  params: Promise<{
    sessionCode: string;
  }>;
};

export default async function PublicSubmissionPage({ params }: PublicRouteProps) {
  const { sessionCode } = await params;
  const session = await db.dJSession.findUnique({
    where: {
      code: sessionCode
    }
  });

  if (!session) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <div className="panel w-full overflow-hidden">
        <div className="border-b border-white/10 bg-white/[0.04] px-6 py-8 sm:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-plasma">Crowd Remix Portal</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">{session.artistName}</h1>
          <p className="mt-3 text-base text-white/72">Track focus: {session.trackName}</p>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-white/70">
            Send one visual change at a time. The system keeps every winning idea inside the artist and track mood, blocks unsafe requests,
            and folds the best crowd prompt into the live visual loop.
          </p>
        </div>

        <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-[1fr_0.8fr]">
          <PublicSubmissionForm sessionCode={session.code} />

          <aside className="rounded-4xl border border-white/10 bg-black/20 p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Visual DNA</p>
            <p className="mt-4 text-sm leading-7 text-white/75">{session.creativeBible}</p>

            <div className="mt-6 space-y-3 text-sm text-white/70">
              <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Allowed motifs: {session.allowedMotifs}
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Palette: {session.colorPalette}
              </div>
              <div className="rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3">
                Venue-safe mode is on.
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
