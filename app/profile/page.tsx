import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOpenAiConnectionStatusForUser } from "@/lib/openai-key-store";
import { ProfileSettingsForm } from "@/components/profile-settings-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const openAiStatus = await getOpenAiConnectionStatusForUser(user.id);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#baff39]">Profile</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">Account Settings</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#c9c7bd]">
            Manage the operator profile, AI connection, and account security for this DJ login.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-[#baff39]"
          >
            Home
          </Link>
          <Link
            href="/sessions"
            className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-2 text-sm text-[#e5e1d8] transition hover:border-[#baff39]"
          >
            Sessions
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md bg-[#baff39] px-4 py-2 text-sm font-semibold text-[#151515] transition hover:brightness-110"
          >
            Dashboard
          </Link>
        </div>
      </header>

      <section className="mt-8">
        <ProfileSettingsForm
          initialUser={{
            email: String(user.email),
            displayName: String(user.displayName),
            avatarUrl: user.avatarUrl ? String(user.avatarUrl) : null
          }}
          initialOpenAiStatus={openAiStatus}
        />
      </section>
    </main>
  );
}
