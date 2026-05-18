"use client";

import { FormEvent, ReactNode, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  defaultAudiencePromptGuide,
  defaultAutomoderationPrompt,
  defaultNegativePrompt,
  defaultRemixPromptTemplate,
  defaultSystemPrompt
} from "@/lib/session-defaults";

const initialForm = {
  name: "",
  artistName: "",
  trackName: "",
  audienceUrlName: "",
  creativeBible: "",
  allowedMotifs: "",
  allowedMotifsEnabled: true,
  bannedTerms: "",
  colorPalette: "",
  colorPaletteEnabled: true,
  motionRules: "",
  basePrompt: "",
  systemPrompt: "",
  systemPromptUseDefault: true,
  automoderationPrompt: "",
  automoderationPromptUseDefault: true,
  audiencePromptGuide: "",
  audiencePromptGuideUseDefault: true,
  remixPromptTemplate: "",
  remixPromptTemplateUseDefault: true,
  negativePrompt: "",
  negativePromptUseDefault: true,
  imageReferenceUrl: "",
  smsNumber: "",
  venueSafeMode: true,
  autoSelectEnabled: true
};

const examples = {
  name: "Neon Echo Launch Set",
  artistName: "Neon Echo",
  trackName: "Skyline Pressure",
  audienceUrlName: "neon-echo-launch",
  creativeBible:
    "Kinetic abstract architecture, mirrored tunnel depth, humid atmosphere, elegant strobe restraint, no literal characters.",
  allowedMotifs: "laser lattice, liquid chrome, skyline fragments, pulse halos",
  bannedTerms: "violence, gore, nudity, celebrity, cartoon mascot",
  colorPalette: "teal, ember, dusk blue, warm sand",
  motionRules: "slow camera drift, pulse on phrase changes, never become chaotic or shaky",
  basePrompt:
    "A looping wide cinematic abstract concert visual with mirrored architecture, chrome fog, pulse halos, and elegant nightclub motion.",
  smsNumber: "+15555555555",
  imageReferenceUrl: "https://...",
  systemPrompt: defaultSystemPrompt,
  automoderationPrompt: defaultAutomoderationPrompt,
  audiencePromptGuide: defaultAudiencePromptGuide,
  remixPromptTemplate: defaultRemixPromptTemplate,
  negativePrompt: defaultNegativePrompt
};

type SessionSetupFormState = typeof initialForm;
type TextFieldName = {
  [Key in keyof SessionSetupFormState]: SessionSetupFormState[Key] extends string ? Key : never;
}[keyof SessionSetupFormState];

export function SessionSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [setupStep, setSetupStep] = useState<"session" | "audience">("session");
  const [origin, setOrigin] = useState("");
  const [confirmedAudienceSlug, setConfirmedAudienceSlug] = useState("");
  const [audienceUrlFeedback, setAudienceUrlFeedback] = useState<string | null>(null);
  const [isCheckingAudienceUrl, setIsCheckingAudienceUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [enhancingField, setEnhancingField] = useState<"creativeBible" | "basePrompt" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const suggestedAudienceSlug =
    normalizeAudienceSlug(`${form.artistName} ${form.trackName}`) ||
    normalizeAudienceSlug(form.name) ||
    examples.audienceUrlName;
  const audienceSlugCandidate = normalizeAudienceSlug(form.audienceUrlName || suggestedAudienceSlug);
  const audiencePath = audienceSlugCandidate ? `/r/${audienceSlugCandidate}` : "/r/your-show";
  const confirmedAudienceUrl = confirmedAudienceSlug ? `${origin || "http://localhost:3000"}/r/${confirmedAudienceSlug}` : "";
  const audienceSlugConfirmed = Boolean(confirmedAudienceSlug && confirmedAudienceSlug === audienceSlugCandidate);

  function updateTextField(field: TextFieldName, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAudienceUrlName(value: string) {
    const normalizedValue = normalizeAudienceSlug(value);

    setForm((current) => ({
      ...current,
      audienceUrlName: value
    }));
    setAudienceUrlFeedback(null);

    if (confirmedAudienceSlug && normalizedValue !== confirmedAudienceSlug) {
      setConfirmedAudienceSlug("");
    }
  }

  async function confirmAudienceUrl() {
    setAudienceUrlFeedback(null);
    setIsCheckingAudienceUrl(true);

    try {
      if (!audienceSlugCandidate || audienceSlugCandidate.length < 3) {
        throw new Error("Use at least three letters or numbers for the audience URL.");
      }

      const response = await fetch(`/api/sessions/audience-url?code=${encodeURIComponent(audienceSlugCandidate)}`);
      const payload = (await response.json().catch(() => null)) as {
        available?: boolean;
        code?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.code) {
        throw new Error(payload?.error ?? "Could not check that audience URL.");
      }

      if (!payload.available) {
        throw new Error("That audience URL is already taken. Try a different name.");
      }

      setForm((current) => ({
        ...current,
        audienceUrlName: payload.code ?? audienceSlugCandidate
      }));
      setConfirmedAudienceSlug(payload.code);
      setAudienceUrlFeedback("Audience URL confirmed. QR code is ready.");
    } catch (error) {
      setConfirmedAudienceSlug("");
      setAudienceUrlFeedback(error instanceof Error ? error.message : "Could not check that audience URL.");
    } finally {
      setIsCheckingAudienceUrl(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!audienceSlugConfirmed) {
      setSetupStep("audience");
      setAudienceUrlFeedback("Confirm the audience URL before creating the session.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        ...form,
        allowedMotifs: form.allowedMotifsEnabled ? form.allowedMotifs : "",
        colorPalette: form.colorPaletteEnabled ? form.colorPalette : "",
        audienceSlug: confirmedAudienceSlug,
        systemPrompt: form.systemPromptUseDefault ? undefined : form.systemPrompt.trim() || undefined,
        automoderationPrompt: form.automoderationPromptUseDefault
          ? undefined
          : form.automoderationPrompt.trim() || undefined,
        audiencePromptGuide: form.audiencePromptGuideUseDefault
          ? undefined
          : form.audiencePromptGuide.trim() || undefined,
        remixPromptTemplate: form.remixPromptTemplateUseDefault
          ? undefined
          : form.remixPromptTemplate.trim() || undefined,
        negativePrompt: form.negativePromptUseDefault ? undefined : form.negativePrompt.trim() || undefined
      };

      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Could not create the session.");
        return;
      }

      startTransition(() => {
        router.push("/dashboard");
        router.refresh();
      });
    } catch {
      setError("Could not create the session.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function enhanceField(target: "creativeBible" | "basePrompt") {
    setEnhanceError(null);
    setEnhancingField(target);

    try {
      const response = await fetch("/api/session-enhance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          target,
          creativeBible: form.creativeBible,
          allowedMotifs: form.allowedMotifs,
          allowedMotifsEnabled: form.allowedMotifsEnabled,
          bannedTerms: form.bannedTerms,
          colorPalette: form.colorPalette,
          colorPaletteEnabled: form.colorPaletteEnabled,
          motionRules: form.motionRules,
          basePrompt: form.basePrompt
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        enhancedText?: string;
      } | null;

      if (!response.ok || !payload?.enhancedText) {
        throw new Error(payload?.error ?? "Could not enhance that field.");
      }

      updateTextField(target, payload.enhancedText);
    } catch (error) {
      setEnhanceError(error instanceof Error ? error.message : "Could not enhance that field.");
    } finally {
      setEnhancingField(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel overflow-hidden">
      <div className="border-b border-[#34383c] px-6 py-5 sm:px-8">
        <div className="flex flex-wrap gap-3 text-sm">
          <StepPill active={setupStep === "session"} label="1. Session Setup" />
          <StepPill active={setupStep === "audience"} label="2. Audience Form" />
        </div>
      </div>

      {setupStep === "session" ? (
        <>
      <FormSection
        eyebrow="Session"
        title="Show Basics"
        body="Name the room, pick the track focus, and connect the intake channel for this run."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <TextInput
            label="Session Name"
            value={form.name}
            onChange={(value) => updateTextField("name", value)}
            placeholder={examples.name}
          />
          <TextInput
            label="Artist"
            value={form.artistName}
            onChange={(value) => updateTextField("artistName", value)}
            placeholder={examples.artistName}
          />
          <TextInput
            label="Track"
            value={form.trackName}
            onChange={(value) => updateTextField("trackName", value)}
            placeholder={examples.trackName}
          />
          <TextInput
            label="Twilio Number"
            value={form.smsNumber}
            onChange={(value) => updateTextField("smsNumber", value)}
            placeholder={examples.smsNumber}
          />
        </div>
      </FormSection>

      <FormSection
        eyebrow="Visual DNA"
        title="Creative Boundaries"
        body="These fields become the source of truth for seed renders, crowd remixes, scoring, and the audience-facing prompt page."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <TextArea
            className="lg:col-span-2"
            label="Creative Bible"
            rows={4}
            value={form.creativeBible}
            onChange={(value) => updateTextField("creativeBible", value)}
            placeholder={examples.creativeBible}
            action={
              <EnhanceButton
                active={enhancingField === "creativeBible"}
                onClick={() => void enhanceField("creativeBible")}
              />
            }
          />
          <ToggleField
            label="Allowed Motifs"
            enabled={form.allowedMotifsEnabled}
            onToggle={(enabled) => setForm((current) => ({ ...current, allowedMotifsEnabled: enabled }))}
          >
            <TextArea
              label="Allowed Motifs"
              labelClassName="sr-only"
              rows={4}
              value={form.allowedMotifs}
              onChange={(value) => updateTextField("allowedMotifs", value)}
              placeholder={examples.allowedMotifs}
              disabled={!form.allowedMotifsEnabled}
            />
          </ToggleField>
          <TextArea
            label="Banned Terms"
            rows={4}
            value={form.bannedTerms}
            onChange={(value) => updateTextField("bannedTerms", value)}
            placeholder={examples.bannedTerms}
          />
          <ToggleField
            label="Color Palette"
            enabled={form.colorPaletteEnabled}
            onToggle={(enabled) => setForm((current) => ({ ...current, colorPaletteEnabled: enabled }))}
          >
            <TextInput
              label="Color Palette"
              labelClassName="sr-only"
              value={form.colorPalette}
              onChange={(value) => updateTextField("colorPalette", value)}
              placeholder={examples.colorPalette}
              disabled={!form.colorPaletteEnabled}
            />
          </ToggleField>
          <TextInput
            label="Motion Rules"
            value={form.motionRules}
            onChange={(value) => updateTextField("motionRules", value)}
            placeholder={examples.motionRules}
          />
          <TextArea
            className="lg:col-span-2"
            label="Base Prompt"
            rows={5}
            value={form.basePrompt}
            onChange={(value) => updateTextField("basePrompt", value)}
            placeholder={examples.basePrompt}
            action={
              <EnhanceButton
                active={enhancingField === "basePrompt"}
                onClick={() => void enhanceField("basePrompt")}
              />
            }
          />
          <TextInput
            className="lg:col-span-2"
            label="Image Reference URL"
            value={form.imageReferenceUrl}
            onChange={(value) => updateTextField("imageReferenceUrl", value)}
            placeholder={examples.imageReferenceUrl}
          />
        </div>
        {enhanceError ? (
          <p className="mt-5 rounded-md border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">
            {enhanceError}
          </p>
        ) : null}
      </FormSection>

      <FormSection
        eyebrow="AI Rules"
        title="System And Automoderation Prompts"
        body="Tune how the AI behaves, how the venue-safe gate makes decisions, and how winning crowd ideas are rewritten into render prompts."
      >
        <div className="grid gap-5">
          <ToggleField
            label="System Prompt"
            toggleLabel="Use default"
            enabled={form.systemPromptUseDefault}
            onToggle={(enabled) =>
              setForm((current) => ({
                ...current,
                systemPromptUseDefault: enabled,
                ...(enabled ? { systemPrompt: "" } : {})
              }))
            }
          >
            <TextArea
              label="System Prompt"
              labelClassName="sr-only"
              rows={5}
              value={form.systemPrompt}
              onChange={(value) => updateTextField("systemPrompt", value)}
              placeholder={examples.systemPrompt}
              disabled={form.systemPromptUseDefault}
            />
          </ToggleField>
          <ToggleField
            label="Automoderation Prompt"
            toggleLabel="Use default"
            enabled={form.automoderationPromptUseDefault}
            onToggle={(enabled) =>
              setForm((current) => ({
                ...current,
                automoderationPromptUseDefault: enabled,
                ...(enabled ? { automoderationPrompt: "" } : {})
              }))
            }
          >
            <TextArea
              label="Automoderation Prompt"
              labelClassName="sr-only"
              rows={6}
              value={form.automoderationPrompt}
              onChange={(value) => updateTextField("automoderationPrompt", value)}
              placeholder={examples.automoderationPrompt}
              disabled={form.automoderationPromptUseDefault}
            />
          </ToggleField>
          <ToggleField
            label="Remix Prompt Template"
            toggleLabel="Use default"
            enabled={form.remixPromptTemplateUseDefault}
            onToggle={(enabled) =>
              setForm((current) => ({
                ...current,
                remixPromptTemplateUseDefault: enabled,
                ...(enabled ? { remixPromptTemplate: "" } : {})
              }))
            }
          >
            <TextArea
              label="Remix Prompt Template"
              labelClassName="sr-only"
              rows={6}
              value={form.remixPromptTemplate}
              onChange={(value) => updateTextField("remixPromptTemplate", value)}
              placeholder={examples.remixPromptTemplate}
              disabled={form.remixPromptTemplateUseDefault}
            />
          </ToggleField>
          <div className="grid gap-5">
            <ToggleField
              label="Negative Prompt"
              toggleLabel="Use default"
              enabled={form.negativePromptUseDefault}
              onToggle={(enabled) =>
                setForm((current) => ({
                  ...current,
                  negativePromptUseDefault: enabled,
                  ...(enabled ? { negativePrompt: "" } : {})
                }))
              }
            >
              <TextArea
                label="Negative Prompt"
                labelClassName="sr-only"
                rows={5}
                value={form.negativePrompt}
                onChange={(value) => updateTextField("negativePrompt", value)}
                placeholder={examples.negativePrompt}
                disabled={form.negativePromptUseDefault}
              />
            </ToggleField>
          </div>
        </div>
      </FormSection>

      <div className="border-t border-[#34383c] px-6 py-6 sm:px-8">
        <div className="flex flex-wrap gap-4 text-sm text-white/75">
          <label className="inline-flex items-center gap-3 rounded-md border border-[#42464a] bg-[#111315] px-4 py-3">
            <input
              type="checkbox"
              checked={form.venueSafeMode}
              onChange={(event) => setForm((current) => ({ ...current, venueSafeMode: event.target.checked }))}
            />
            Venue-safe mode
          </label>

          <label className="inline-flex items-center gap-3 rounded-md border border-[#42464a] bg-[#111315] px-4 py-3">
            <input
              type="checkbox"
              checked={form.autoSelectEnabled}
              onChange={(event) => setForm((current) => ({ ...current, autoSelectEnabled: event.target.checked }))}
            />
            Auto-select winning prompts
          </label>
        </div>

        {error ? <p className="mt-5 rounded-md border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</p> : null}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-sm leading-7 text-white/65">
            Creating a new session keeps earlier sessions intact. Continue Session will always open the most recent session for this account.
          </p>

          <button
            type="button"
            onClick={() => setSetupStep("audience")}
            className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90"
          >
            Continue To Audience Form
          </button>
        </div>
      </div>
        </>
      ) : (
        <>
          <FormSection
            eyebrow="Audience Form"
            title="Customize The Crowd Entry Point"
            body="Choose the public URL where audience members submit remix ideas, confirm it, and use the QR code for the room."
          >
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <TextInput
                  label="Audience URL Name"
                  value={form.audienceUrlName}
                  onChange={updateAudienceUrlName}
                  placeholder={suggestedAudienceSlug || examples.audienceUrlName}
                />

                <div className="rounded-md border border-white/10 bg-black/20 px-4 py-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">Public URL Preview</p>
                  <p className="mt-3 break-all font-mono text-sm text-white/80">
                    {(origin || "http://localhost:3000") + audiencePath}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => updateAudienceUrlName(suggestedAudienceSlug)}
                    className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-3 text-sm font-semibold text-[#e5e1d8] transition hover:border-plasma"
                  >
                    Use Suggested Name
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmAudienceUrl()}
                    disabled={isCheckingAudienceUrl}
                    className="rounded-md bg-[#baff39] px-4 py-3 text-sm font-semibold text-[#151515] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCheckingAudienceUrl ? "Checking..." : audienceSlugConfirmed ? "URL Confirmed" : "Confirm URL Name"}
                  </button>
                </div>

                {audienceUrlFeedback ? (
                  <p
                    className={`rounded-md border px-4 py-3 text-sm ${
                      audienceSlugConfirmed
                        ? "border-[#baff39]/25 bg-[#baff39]/10 text-[#d7ff88]"
                        : "border-ember/20 bg-ember/10 text-ember"
                    }`}
                  >
                    {audienceUrlFeedback}
                  </p>
                ) : null}

                <ToggleField
                  label="Audience Prompt Guide"
                  toggleLabel="Use default"
                  enabled={form.audiencePromptGuideUseDefault}
                  onToggle={(enabled) =>
                    setForm((current) => ({
                      ...current,
                      audiencePromptGuideUseDefault: enabled,
                      ...(enabled ? { audiencePromptGuide: "" } : {})
                    }))
                  }
                >
                  <TextArea
                    label="Audience Prompt Guide"
                    labelClassName="sr-only"
                    rows={5}
                    value={form.audiencePromptGuide}
                    onChange={(value) => updateTextField("audiencePromptGuide", value)}
                    placeholder={examples.audiencePromptGuide}
                    disabled={form.audiencePromptGuideUseDefault}
                  />
                </ToggleField>
              </div>

              <div className="rounded-md border border-white/10 bg-black/20 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/45">QR Code</p>
                {audienceSlugConfirmed ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-md bg-white p-4">
                      <img
                        src={`/api/qr?data=${encodeURIComponent(confirmedAudienceUrl)}`}
                        alt={`QR code for ${confirmedAudienceUrl}`}
                        className="mx-auto aspect-square w-full max-w-[280px]"
                      />
                    </div>
                    <p className="break-all font-mono text-sm text-white/72">{confirmedAudienceUrl}</p>
                  </div>
                ) : (
                  <div className="mt-5 flex aspect-square max-w-[320px] items-center justify-center rounded-md border border-dashed border-white/15 bg-black/25 px-6 text-center text-sm leading-7 text-white/55">
                    Confirm the URL name to generate the room QR code.
                  </div>
                )}
              </div>
            </div>
          </FormSection>

          <div className="border-t border-[#34383c] px-6 py-6 sm:px-8">
            {error ? <p className="mb-5 rounded-md border border-ember/20 bg-ember/10 px-4 py-3 text-sm text-ember">{error}</p> : null}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setSetupStep("session")}
                className="rounded-md border border-[#42464a] bg-[#232529] px-5 py-3 text-sm font-semibold text-[#e5e1d8] transition hover:border-plasma"
              >
                Back To Session Setup
              </button>

              <button
                type="submit"
                disabled={isSubmitting || isPending || !audienceSlugConfirmed}
                className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting || isPending ? "Creating..." : "Create New Session"}
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}

function StepPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
        active
          ? "border-[#baff39]/35 bg-[#baff39]/10 text-[#d7ff88]"
          : "border-white/10 bg-black/20 text-white/45"
      }`}
    >
      {label}
    </span>
  );
}

function FormSection({
  eyebrow,
  title,
  body,
  children
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[#34383c] px-6 py-7 last:border-b-0 sm:px-8">
      <div className="mb-6 max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8f9499]">{eyebrow}</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-[#aaa79f]">{body}</p>
      </div>
      {children}
    </section>
  );
}

function normalizeAudienceSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48)
    .replace(/(^-|-$)/g, "");
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  labelClassName = "",
  className = ""
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={`mb-2 block text-sm font-medium text-white/80 ${labelClassName}`}>{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-plasma disabled:cursor-not-allowed disabled:opacity-45"
        placeholder={placeholder}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows,
  placeholder,
  action,
  disabled = false,
  labelClassName = "",
  className = ""
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  action?: ReactNode;
  disabled?: boolean;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 flex items-center justify-between gap-3">
        <span className={`block text-sm font-medium text-white/80 ${labelClassName}`}>{label}</span>
        {action}
      </span>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-plasma disabled:cursor-not-allowed disabled:opacity-45"
      />
    </label>
  );
}

function ToggleField({
  label,
  toggleLabel,
  enabled,
  onToggle,
  children
}: {
  label: string;
  toggleLabel?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="text-sm font-semibold uppercase tracking-[0.16em] text-white/80">{label}</span>
        <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/65">
          {toggleLabel ?? (enabled ? "On" : "Off")}
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="h-4 w-4"
          />
        </label>
      </div>
      {children}
    </div>
  );
}

function EnhanceButton({
  active,
  onClick
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active}
      className="shrink-0 rounded-md border border-plasma/30 bg-plasma/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-plasma transition hover:border-plasma disabled:cursor-not-allowed disabled:opacity-55"
    >
      {active ? "Enhancing..." : "AI Enhance"}
    </button>
  );
}
