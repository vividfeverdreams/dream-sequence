import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string | string[];
  }>;
};

function getSafeRedirect(next?: string | string[]) {
  const value = Array.isArray(next) ? next[0] : next;

  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/sessions";
  }

  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const redirectTo = getSafeRedirect(params.next);
  const user = await getCurrentUser();

  if (user) {
    redirect(redirectTo);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="panel grid w-full max-w-5xl overflow-hidden lg:grid-cols-[0.95fr_1.05fr]">
        <section className="border-b border-white/10 bg-white/[0.04] p-8 lg:border-b-0 lg:border-r lg:p-10">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-plasma">DJ Access</p>
          <h1 className="mt-5 text-4xl font-semibold text-white">Run the room without losing the loop.</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-white/70">
            Log in to configure the session, review the crowd queue, and control when the next Sora remix takes the screen.
          </p>

          <div className="mt-10 space-y-4 text-sm text-white/70">
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              Crowd input from SMS and QR form lands in one ranked venue-safe queue.
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              The current loop stays live until the next completed remix is ready to crossfade.
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-4">
              DJ controls stay simple: pause selection, trigger fallback, skip to next.
            </div>
          </div>
        </section>

        <section className="p-8 lg:p-10">
          <LoginForm redirectTo={redirectTo} />
        </section>
      </div>
    </main>
  );
}
