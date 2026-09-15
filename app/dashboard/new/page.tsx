import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SessionSetupForm } from "@/components/session-setup-form";

export default async function NewSessionPage() {
  await requireUser();

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">DREAM SEQUENCE</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">Start a story. See where it goes.</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-white/70">
            Write the opening scene, choose your clip settings, and invite your audience to shape what comes next.
          </p>
        </div>

        <Link href="/dashboard" className="rounded-full border border-white/10 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10">
          Back To Dashboard
        </Link>
      </header>

      <section className="mt-10">
        <SessionSetupForm />
      </section>
    </main>
  );
}
