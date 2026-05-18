import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SessionSetupForm } from "@/components/session-setup-form";

export const dynamic = "force-dynamic";

export default async function NewSessionPage() {
  await requireUser();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">New Session</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">Customize the next run.</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
            Tune the creative DNA, AI behavior, automoderation rules, and audience instructions before the room goes live.
          </p>
        </div>

        <Link href="/sessions" className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-plasma">
          Sessions
        </Link>
      </header>

      <section className="mt-10">
        <SessionSetupForm />
      </section>
    </main>
  );
}
