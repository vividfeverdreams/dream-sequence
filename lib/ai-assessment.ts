import { z } from "zod";
import { env } from "@/lib/env";
import { getOpenAiClient } from "@/lib/openai-client";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import { clamp, normalizePromptText, splitList } from "@/lib/utils";

const assessmentSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  score: z.number().int().min(0).max(100),
  flags: z.array(z.string()).max(8),
  explanation: z.string().min(1).max(300),
  approvalReason: z.string().min(1).max(240),
  noveltyScore: z.number().int().min(0).max(100),
  cohesionScore: z.number().int().min(0).max(100),
  remixDeltaScore: z.number().int().min(0).max(100),
  winningPrompt: z.string().min(20).max(900)
});

type SessionContext = {
  userId?: string;
  artistName: string;
  trackName: string;
  creativeBible: string;
  allowedMotifs: string;
  bannedTerms: string;
  colorPalette: string;
  motionRules: string;
  basePrompt: string;
};

type AssessmentInput = {
  submissionText: string;
  session: SessionContext;
  recentWinningPrompts: string[];
};

export type SubmissionAssessment = z.infer<typeof assessmentSchema>;

const hardBlockedTerms = [
  "nazi",
  "hitler",
  "suicide",
  "kill",
  "murder",
  "porn",
  "nude",
  "blood",
  "gore",
  "cocaine",
  "meth"
];

export async function assessSubmission(input: AssessmentInput): Promise<SubmissionAssessment> {
  const apiKey = input.session.userId
    ? await getEffectiveOpenAiApiKeyForUser(input.session.userId)
    : env.openAiApiKey || null;

  if (!apiKey) {
    return heuristicAssessment(input);
  }

  try {
    const client = getOpenAiClient(apiKey);

    if (!client) {
      return heuristicAssessment(input);
    }

    const response = await client.responses.create({
      model: env.openAiTextModel,
      temperature: 0.4,
      instructions: [
        "You are the crowd prompt safety and remix-ranking engine for a live DJ visual platform.",
        "You must keep every approved prompt within the DJ's visual DNA.",
        "Reject prompts that are unsafe, spammy, off-theme, ask for real people, public figures, copyrighted characters, copyrighted music references, or anything that is not venue-safe.",
        "For approved prompts, rewrite the input into a single focused remix instruction that preserves the session's current visual identity.",
        "Return only valid JSON that matches the provided schema."
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input)
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "submission_assessment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: {
                type: "string",
                enum: ["approved", "rejected"]
              },
              score: {
                type: "integer"
              },
              flags: {
                type: "array",
                items: {
                  type: "string"
                }
              },
              explanation: {
                type: "string"
              },
              approvalReason: {
                type: "string"
              },
              noveltyScore: {
                type: "integer"
              },
              cohesionScore: {
                type: "integer"
              },
              remixDeltaScore: {
                type: "integer"
              },
              winningPrompt: {
                type: "string"
              }
            },
            required: [
              "decision",
              "score",
              "flags",
              "explanation",
              "approvalReason",
              "noveltyScore",
              "cohesionScore",
              "remixDeltaScore",
              "winningPrompt"
            ]
          }
        }
      }
    });

    return assessmentSchema.parse(JSON.parse(response.output_text));
  } catch {
    return heuristicAssessment(input);
  }
}

export function heuristicAssessment(input: AssessmentInput): SubmissionAssessment {
  const normalized = normalizePromptText(input.submissionText).toLowerCase();
  const bannedTerms = splitList(input.session.bannedTerms).map((term) => term.toLowerCase());

  const flags = new Set<string>();
  let decision: "approved" | "rejected" = "approved";

  for (const blocked of [...hardBlockedTerms, ...bannedTerms]) {
    if (blocked && normalized.includes(blocked)) {
      flags.add("blocked-term");
      decision = "rejected";
    }
  }

  if (normalized.length < 6) {
    flags.add("too-short");
    decision = "rejected";
  }

  const recentDuplicate = input.recentWinningPrompts.some((prompt) =>
    prompt.toLowerCase().includes(normalized)
  );

  if (recentDuplicate) {
    flags.add("too-similar");
  }

  const cohesionScore = clamp(
    72 + splitList(input.session.allowedMotifs).filter((motif) => normalized.includes(motif.toLowerCase())).length * 6,
    25,
    100
  );
  const noveltyScore = clamp(recentDuplicate ? 42 : 74, 0, 100);
  const remixDeltaScore = clamp(normalized.length > 18 ? 81 : 54, 0, 100);
  const score = clamp(Math.round((cohesionScore + noveltyScore + remixDeltaScore) / 3), 0, 100);

  return {
    decision,
    score: decision === "approved" ? score : Math.min(score, 25),
    flags: Array.from(flags),
    explanation:
      decision === "approved"
        ? "Approved by the fallback heuristic scorer as safe and compatible with the set's visual DNA."
        : "Rejected by the fallback heuristic safety checks.",
    approvalReason:
      decision === "approved"
        ? "Keeps the crowd idea inside the artist and track envelope while changing one visible trait."
        : "Does not meet the venue-safe remix filter.",
    noveltyScore,
    cohesionScore,
    remixDeltaScore,
    winningPrompt: [
      `Remix the active loop for ${input.session.artistName} - ${input.session.trackName}.`,
      `Keep the visual DNA anchored in: ${input.session.creativeBible}.`,
      `Allowed motifs: ${input.session.allowedMotifs}.`,
      `Palette: ${input.session.colorPalette}. Motion rules: ${input.session.motionRules}.`,
      `Make one focused crowd-requested change: ${normalizePromptText(input.submissionText)}.`,
      "Preserve continuity, camera feel, and venue-safe abstract artistry. No text overlays, no real people, no copyrighted characters."
    ].join(" ")
  };
}
