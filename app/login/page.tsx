import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-ink text-haze">
      <img
        src="/landing/chapter-4.jpg"
        alt=""
        className="absolute inset-0 -z-10 h-full w-full object-cover opacity-55"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/40 via-ink/60 to-ink" />
      <div className="film-grain absolute inset-0 -z-10" />

      <header className="px-4 py-5 sm:px-8 lg:px-12">
        <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 font-display text-2xl leading-none text-haze">
          Dream <em>Sequence</em>
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 pb-16 pt-6 sm:px-8 lg:justify-end lg:px-24">
        <section className="w-full max-w-md rounded-[1.75rem] border border-white/10 bg-[#111114]/95 p-6 shadow-glow sm:p-8">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}
