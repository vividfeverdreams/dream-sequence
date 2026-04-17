import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const sessionFormSchema = z.object({
  name: z.string().min(3).max(100),
  artistName: z.string().min(2).max(100),
  trackName: z.string().min(2).max(100),
  creativeBible: z.string().min(20).max(600),
  allowedMotifs: z.string().min(3).max(400),
  bannedTerms: z.string().min(3).max(400),
  colorPalette: z.string().min(3).max(200),
  motionRules: z.string().min(3).max(300),
  basePrompt: z.string().min(20).max(1200),
  imageReferenceUrl: z.string().url().optional().or(z.literal("")),
  smsNumber: z.string().optional(),
  venueSafeMode: z.boolean().default(true),
  autoSelectEnabled: z.boolean().default(true)
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
  value: z.boolean().optional()
});
