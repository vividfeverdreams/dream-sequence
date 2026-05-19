import { z } from "zod";
import {
  defaultAudiencePromptGuide,
  defaultAutomoderationPrompt,
  defaultNegativePrompt,
  defaultRemixPromptTemplate,
  defaultSystemPrompt
} from "@/lib/session-defaults";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const signupSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128)
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export const resendVerificationSchema = z.object({
  email: z.string().trim().email()
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarUrl: z.string().trim().url().max(500).optional().or(z.literal(""))
});

export const passwordUpdateSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128)
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

export const openAiApiKeySchema = z.object({
  apiKey: z.string().trim().min(20).max(300)
});

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const defaultedSessionText = (defaultValue: string, min: number, max: number) =>
  z.preprocess(blankToUndefined, z.string().min(min).max(max).default(defaultValue));

const optionalSessionText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().max(max).default(""));

export const sessionFormSchema = z.object({
  name: z.string().min(3).max(100),
  artistName: z.string().min(2).max(100),
  trackName: z.string().min(2).max(100),
  audienceSlug: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  creativeBible: z.string().min(20).max(600),
  allowedMotifs: optionalSessionText(400),
  bannedTerms: z.string().min(3).max(400),
  colorPalette: optionalSessionText(200),
  motionRules: z.string().min(3).max(300),
  basePrompt: z.string().min(20).max(1200),
  systemPrompt: defaultedSessionText(defaultSystemPrompt, 20, 2400),
  automoderationPrompt: defaultedSessionText(defaultAutomoderationPrompt, 20, 2400),
  audiencePromptGuide: defaultedSessionText(defaultAudiencePromptGuide, 10, 700),
  remixPromptTemplate: defaultedSessionText(defaultRemixPromptTemplate, 20, 2400),
  negativePrompt: defaultedSessionText(defaultNegativePrompt, 0, 900),
  imageReferenceUrl: z.string().url().optional().or(z.literal("")),
  smsNumber: z.string().optional(),
  venueSafeMode: z.boolean().default(true),
  autoSelectEnabled: z.boolean().default(true)
});

export const sessionEnhanceSchema = z.object({
  target: z.enum(["creativeBible", "basePrompt"]),
  creativeBible: z.string().max(1000).default(""),
  allowedMotifs: z.string().max(500).default(""),
  allowedMotifsEnabled: z.boolean().default(true),
  bannedTerms: z.string().max(500).default(""),
  colorPalette: z.string().max(250).default(""),
  colorPaletteEnabled: z.boolean().default(true),
  motionRules: z.string().max(400).default(""),
  basePrompt: z.string().max(1400).default("")
});

export const publicSubmissionSchema = z.object({
  prompt: z.string().min(4).max(240),
  senderLabel: z.string().max(80).optional()
});

export const inboundSmsSchema = z.object({
  Body: z.string().min(1),
  From: z.string().min(3),
  To: z.string().min(3),
  MessageSid: z.string().optional()
});

export const controlSchema = z.object({
  action: z.enum(["pause-selection", "resume-selection", "skip-next", "fallback-remix", "stop-session"]),
  value: z.boolean().optional(),
  transitionSeconds: z.number().min(0).max(8).optional()
});
