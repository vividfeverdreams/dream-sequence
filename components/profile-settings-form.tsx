"use client";

import { FormEvent, useState } from "react";
import type { ReactNode } from "react";
import type { OpenAiConnectionStatus } from "@/lib/openai-key-store";

type ProfileUser = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

type Feedback = {
  tone: "success" | "error";
  message: string;
} | null;

type ProfileSettingsFormProps = {
  initialUser: ProfileUser;
  initialOpenAiStatus: OpenAiConnectionStatus;
};

export function ProfileSettingsForm({
  initialUser,
  initialOpenAiStatus
}: ProfileSettingsFormProps) {
  const [profile, setProfile] = useState(initialUser);
  const [profileDraft, setProfileDraft] = useState({
    displayName: initialUser.displayName,
    avatarUrl: initialUser.avatarUrl ?? ""
  });
  const [passwordDraft, setPasswordDraft] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [apiKey, setApiKey] = useState("");
  const [openAiStatus, setOpenAiStatus] = useState(initialOpenAiStatus);
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [apiFeedback, setApiFeedback] = useState<Feedback>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingApiKey, setSavingApiKey] = useState(false);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileFeedback(null);
    setSavingProfile(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(profileDraft)
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        user?: ProfileUser;
      } | null;

      if (!response.ok || !payload?.user) {
        throw new Error(payload?.error ?? "Could not save profile.");
      }

      setProfile(payload.user);
      setProfileDraft({
        displayName: payload.user.displayName,
        avatarUrl: payload.user.avatarUrl ?? ""
      });
      setProfileFeedback({
        tone: "success",
        message: "Profile updated."
      });
    } catch (error) {
      setProfileFeedback({
        tone: "error",
        message: describeError(error, "Could not save profile.")
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordFeedback(null);
    setSavingPassword(true);

    try {
      const response = await fetch("/api/profile/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(passwordDraft)
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not update password.");
      }

      setPasswordDraft({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      });
      setPasswordFeedback({
        tone: "success",
        message: "Password updated."
      });
    } catch (error) {
      setPasswordFeedback({
        tone: "error",
        message: describeError(error, "Could not update password.")
      });
    } finally {
      setSavingPassword(false);
    }
  }

  async function submitApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiFeedback(null);
    setSavingApiKey(true);

    try {
      const response = await fetch("/api/profile/openai-key", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          apiKey
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        openAiStatus?: OpenAiConnectionStatus;
      } | null;

      if (!response.ok || !payload?.openAiStatus) {
        throw new Error(payload?.error ?? "Could not save API key.");
      }

      setApiKey("");
      setOpenAiStatus(payload.openAiStatus);
      setApiFeedback({
        tone: "success",
        message: "OpenAI API key saved."
      });
    } catch (error) {
      setApiFeedback({
        tone: "error",
        message: describeError(error, "Could not save API key.")
      });
    } finally {
      setSavingApiKey(false);
    }
  }

  async function clearApiKey() {
    setApiFeedback(null);
    setSavingApiKey(true);

    try {
      const response = await fetch("/api/profile/openai-key", {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        openAiStatus?: OpenAiConnectionStatus;
      } | null;

      if (!response.ok || !payload?.openAiStatus) {
        throw new Error(payload?.error ?? "Could not remove API key.");
      }

      setOpenAiStatus(payload.openAiStatus);
      setApiFeedback({
        tone: "success",
        message: "Account API key removed."
      });
    } catch (error) {
      setApiFeedback({
        tone: "error",
        message: describeError(error, "Could not remove API key.")
      });
    } finally {
      setSavingApiKey(false);
    }
  }

  const initials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="panel p-6">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8f9499]">Account</p>
        <div className="mt-6 flex items-center gap-5">
          <div
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#232529] bg-cover bg-center text-3xl font-semibold text-white shadow-glow"
            style={profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined}
            aria-label="Profile picture preview"
          >
            {profile.avatarUrl ? null : initials || "DJ"}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-semibold text-white">{profile.displayName}</h1>
            <p className="mt-2 break-all text-sm text-[#aaa79f]">{profile.email}</p>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-[#34383c] bg-[#111315] px-4 py-4 text-sm leading-7 text-[#c9c7bd]">
          OpenAI status: {describeOpenAiStatus(openAiStatus)}
        </div>
      </section>

      <form onSubmit={submitProfile} className="panel p-6">
        <SectionHeading
          eyebrow="Profile"
          title="Public Identity"
          body="This is the operator profile used around authenticated control surfaces."
        />

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <TextInput
            label="Display Name"
            value={profileDraft.displayName}
            onChange={(value) => setProfileDraft((current) => ({ ...current, displayName: value }))}
          />
          <TextInput label="Email" value={profile.email} readOnly />
          <TextInput
            className="md:col-span-2"
            label="Profile Picture URL"
            value={profileDraft.avatarUrl}
            onChange={(value) => setProfileDraft((current) => ({ ...current, avatarUrl: value }))}
            placeholder="https://..."
          />
        </div>

        <FormFooter feedback={profileFeedback}>
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingProfile ? "Saving..." : "Save Profile"}
          </button>
        </FormFooter>
      </form>

      <form onSubmit={submitApiKey} className="panel p-6">
        <SectionHeading
          eyebrow="API Keys"
          title="OpenAI Connection"
          body="Account keys are used for moderation, ranking, and Sora generation before falling back to the server environment."
        />

        <div className="mt-6 rounded-md border border-[#34383c] bg-[#111315] px-4 py-4 text-sm leading-7 text-[#c9c7bd]">
          {describeOpenAiStatus(openAiStatus)}
        </div>

        <div className="mt-5">
          <TextInput
            label="OpenAI API Key"
            type="password"
            value={apiKey}
            onChange={setApiKey}
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>

        <FormFooter feedback={apiFeedback}>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={savingApiKey}
              className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingApiKey ? "Saving..." : "Save API Key"}
            </button>
            <button
              type="button"
              disabled={savingApiKey || openAiStatus.source !== "account"}
              onClick={() => void clearApiKey()}
              className="rounded-md border border-[#42464a] bg-[#232529] px-5 py-3 text-sm font-semibold text-[#e5e1d8] transition hover:border-[#ff764d] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Remove Account Key
            </button>
          </div>
        </FormFooter>
      </form>

      <form onSubmit={submitPassword} className="panel p-6">
        <SectionHeading
          eyebrow="Security"
          title="Password Reset"
          body="Change the password for this local DJ account."
        />

        <div className="mt-6 grid gap-5">
          <TextInput
            label="Current Password"
            type="password"
            value={passwordDraft.currentPassword}
            onChange={(value) => setPasswordDraft((current) => ({ ...current, currentPassword: value }))}
            autoComplete="current-password"
          />
          <div className="grid gap-5 md:grid-cols-2">
            <TextInput
              label="New Password"
              type="password"
              value={passwordDraft.newPassword}
              onChange={(value) => setPasswordDraft((current) => ({ ...current, newPassword: value }))}
              autoComplete="new-password"
            />
            <TextInput
              label="Confirm New Password"
              type="password"
              value={passwordDraft.confirmPassword}
              onChange={(value) => setPasswordDraft((current) => ({ ...current, confirmPassword: value }))}
              autoComplete="new-password"
            />
          </div>
        </div>

        <FormFooter feedback={passwordFeedback}>
          <button
            type="submit"
            disabled={savingPassword}
            className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingPassword ? "Updating..." : "Update Password"}
          </button>
        </FormFooter>
      </form>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8f9499]">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-[#aaa79f]">{body}</p>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  autoComplete,
  className = ""
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-sm font-medium text-white/80">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-[#42464a] bg-[#111315] px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-[#baff39] read-only:cursor-not-allowed read-only:text-white/55"
      />
    </label>
  );
}

function FormFooter({
  feedback,
  children
}: {
  feedback: Feedback;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
      {feedback ? (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            feedback.tone === "success"
              ? "border-[#baff39]/25 bg-[#baff39]/10 text-[#d7ff88]"
              : "border-ember/20 bg-ember/10 text-ember"
          }`}
        >
          {feedback.message}
        </p>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}

function describeOpenAiStatus(status: OpenAiConnectionStatus) {
  if (status.source === "account") {
    return `Using account OpenAI key${status.last4 ? ` ending in ${status.last4}` : ""}.`;
  }

  if (status.source === "env") {
    return `Using server OPENAI_API_KEY${status.last4 ? ` ending in ${status.last4}` : ""}.`;
  }

  return "No OpenAI API key is connected.";
}

function describeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
