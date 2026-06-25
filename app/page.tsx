import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-ink bg-aurora">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/55">
              DREAM SEQUENCE
            </p>
            <p className="mt-2 max-w-sm text-sm text-white/70">
              Live crowd-controlled Sora remixes for projector and LED wall shows.
            </p>
          </div>

          <Link
            href="/login"
            className="rounded-full border border-white/15 bg-white/8 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/14"
          >
            DJ Login
          </Link>
        </header>

        <section className="grid gap-8 py-14 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-7">
            <p className="font-mono text-xs uppercase tracking-[0.32em] text-plasma">
              Single-DJ Live MVP
            </p>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-5xl font-semibold leading-tight text-white md:text-7xl">
                Keep the visual loop alive while the crowd bends the universe.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-white/72 md:text-xl">
                DREAM SEQUENCE ingests prompts from SMS and QR form submissions, scores them for
                safety and vibe match, remixes the active Sora loop, and crossfades into the next
                approved visual as soon as it is ready.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
              >
                Open Dashboard
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Configure a Show
              </Link>
            </div>
          </div>

          <div className="rounded-4xl border border-white/10 bg-white/7 p-6 shadow-glow backdrop-blur">
            <div className="rounded-[1.6rem] border border-white/8 bg-black/30 p-6">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/45">
                <span>Live Pipeline</span>
                <span>Venue-Safe</span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  "SMS + QR intake",
                  "Moderation + anti-spam",
                  "AI ranking + prompt rewrite",
                  "Sora remix queue",
                  "Double-buffer crossfade"
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-3xl border border-white/8 bg-white/[0.04] px-4 py-3"
                  >
                    <span className="text-sm text-white/85">{item}</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-plasma shadow-[0_0_18px_rgba(16,214,160,0.7)]" />
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-3xl border border-ember/25 bg-ember/10 p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ember">
                  Live Constraint
                </p>
                <p className="mt-2 text-sm leading-6 text-white/74">
                  The current loop keeps playing until the next completed Sora remix is ready.
                </p>
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 py-5 text-xs uppercase tracking-[0.28em] text-white/40">
          Browser-based visual control for DJs, clubs, pop-ups, and experimental live sets.
        </footer>
      </div>
    </main>
  );
}
