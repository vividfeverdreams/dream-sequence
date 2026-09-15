import { z } from "zod";
import {
  defaultVideoModelId,
  getVideoModelDefinition,
  isVideoModelDurationSupported,
  videoModelIds,
  videoResolutions,
  defaultVideoResolution
} from "@/lib/video-models";

function requiredText(label: string, maxLength: number) {
  return z
    .string({
      required_error: `${label} is required.`
    })
    .trim()
    .min(1, `${label} is required.`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`);
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const sessionFormSchema = z.object({
  basePrompt: requiredText("Story opening", 1200),
  // Retained storage fields have defaults so setup needs only the story opening.
  name: z.string().trim().max(100).default(""),
  artistName: z.string().trim().max(100).default("Live Story"),
  trackName: z.string().trim().max(100).default("DREAM SEQUENCE"),
  creativeBible: z.string().trim().max(1200).default(""),
  allowedMotifs: z.string().trim().max(400).default(""),
  bannedTerms: z.string().trim().max(400).default(""),
  colorPalette: z.string().trim().max(200).default(""),
  motionRules: z.string().trim().max(300).default(""),
  venueSafeMode: z.boolean().default(true),
  artistControlEnabled: z.boolean().default(true),
  autoSelectEnabled: z.boolean().default(true),
  videoModel: z.enum(videoModelIds).default(defaultVideoModelId),
  videoDurationSeconds: z.number().int("Clip length must be a whole number of seconds.")
    .default(getVideoModelDefinition(defaultVideoModelId).defaultDurationSeconds),
  videoResolution: z.enum(videoResolutions).default(defaultVideoResolution),
  audienceMode: z.enum(["web", "twitch"]).default("web"),
  submissionRateLimitEnabled: z.boolean().default(true),
  submissionRateLimitCount: z.number().int().min(1).max(20).default(3)
}).superRefine((session, context) => {
  if (!isVideoModelDurationSupported(session.videoModel, session.videoDurationSeconds)) {
    const model = getVideoModelDefinition(session.videoModel);
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Clip length must be between ${model.minDurationSeconds} and ${model.maxDurationSeconds} seconds for ${model.label}.`,
      path: ["videoDurationSeconds"]
    });
  }
});

export const sessionIdeaSchema = z.object({
  idea: requiredText("Session idea", 1200).refine(
    (value) => value.length >= 4,
    "Tell us a little more about the session you want to create."
  )
});

export const sessionPrefillSchema = z.object({
  name: requiredText("Session name", 100).describe("A concise, distinctive name for this live visual session."),
  artistName: requiredText("Artist", 100).describe(
    "The artist or DJ name from the idea. Use 'Live Artist' if the user did not provide one; never invent a real artist."
  ),
  trackName: requiredText("Track", 100).describe(
    "The track or set name from the idea. Use 'Continuous Mix' if the user did not provide one; never invent a real track."
  ),
  creativeBible: requiredText("Creative bible", 600).describe(
    "A cohesive art-direction paragraph covering the visual world, mood, materials, composition, lighting, and explicit stylistic boundaries."
  ),
  allowedMotifs: requiredText("Allowed motifs", 400).describe(
    "A comma-separated list of concrete visual motifs that crowd remixes may use."
  ),
  bannedTerms: requiredText("Banned terms", 400).describe(
    "A comma-separated list of imagery, subjects, styles, and safety risks that should never appear."
  ),
  colorPalette: requiredText("Color palette", 200).describe(
    "A concise comma-separated palette with evocative, production-usable color names."
  ),
  motionRules: requiredText("Motion rules", 300).describe(
    "Artist-directed rhythm and transition guidance. Include a camera style only when the user's idea explicitly asks for one; otherwise leave camera behavior unrestricted."
  ),
  basePrompt: requiredText("Base prompt", 1200).describe(
    "A polished, standalone prompt for the first looping cinematic concert visual."
  )
});

export const publicSubmissionSchema = z.object({
  prompt: requiredText("What happens next", 1200).min(6, "Describe what happens next in at least 6 characters."),
  senderLabel: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? undefined : value,
    z.string().trim().min(2, "Use at least 2 characters for your nickname.").max(24)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, "Use letters, numbers, spaces, dots, dashes, or underscores in your nickname.")
      .default("Guest")
  ),
  participantToken: z.string().trim().min(16).max(200)
});

export const inboundSmsSchema = z.object({
  Body: z.string().min(1),
  From: z.string().min(3),
  To: z.string().min(3),
  MessageSid: z.string().optional()
});

export const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["pause-selection", "resume-selection", "skip-next", "fallback-remix", "stop-session"])
  }),
  z.object({
    action: z.literal("cue-generation"),
    assetId: z.string().trim().min(1).max(120)
  }),
  z.object({
    action: z.literal("set-qr-overlay"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-wordmark-overlay"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-wordmark-opacity"),
    value: z.number().min(0).max(1)
  }),
  z.object({
    action: z.literal("set-wordmark-size"),
    value: z.number().min(0.3).max(1.5)
  }),
  z.object({
    action: z.literal("set-wordmark-audio-reactive-only"),
    value: z.boolean()
  }),
  z.object({
    action: z.literal("set-progress-overlay"),
    value: z.boolean()
  })
]);
