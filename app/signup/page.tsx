import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/sessions");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="panel grid w-full max-w-5xl overflow-hidden lg:grid-cols-[0.95fr_1.05fr]">
        <section className="border-b border-white/10 bg-white/[0.04] p-8 lg:border-b-0 lg:border-r lg:p-10">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-plasma">Dream Sequence</p>
          <h1 className="mt-5 text-4xl font-semibold text-white">Create the control room before the crowd arrives.</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-white/70">
            Verified accounts keep session setup, profile keys, and dashboard access tied to the right DJ.
          </p>

          <div className="mt-10 space-y-4 text-sm text-white/70">
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              Verify email before the first dashboard session opens.
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              Store profile settings, API keys, and venue defaults under one account.
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              Continue the latest session or start a customized run after sign in.
            </div>
          </div>
        </section>

        <section className="p-8 lg:p-10">
          <SignupForm />
        </section>
      </div>
    </main>
  );
}
