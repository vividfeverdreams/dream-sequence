import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getOpenAiClient } from "@/lib/openai-client";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import { sessionEnhanceSchema } from "@/lib/schemas";
import { normalizePromptText } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "You need to log in first."
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = sessionEnhanceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "The enhancement request is incomplete."
      },
      {
        status: 400
      }
    );
  }

  const input = parsed.data;
  const hasStartingPoint =
    input.target === "creativeBible"
      ? input.creativeBible.trim().length > 0
      : [
          input.creativeBible,
          input.allowedMotifsEnabled ? input.allowedMotifs : "",
          input.bannedTerms,
          input.colorPaletteEnabled ? input.colorPalette : "",
          input.motionRules,
          input.basePrompt
        ].some((value) => value.trim().length > 0);

  if (!hasStartingPoint) {
    return NextResponse.json(
      {
        error:
          input.target === "creativeBible"
            ? "Write a rough creative direction first."
            : "Add creative context before enhancing the base prompt."
      },
      {
        status: 400
      }
    );
  }

  const apiKey = await getEffectiveOpenAiApiKeyForUser(user.id);
  const client = getOpenAiClient(apiKey);

  if (!client) {
    return NextResponse.json({
      enhancedText: fallbackEnhancement(input)
    });
  }

  try {
    const response = await client.responses.create({
      model: env.openAiTextModel,
      temperature: 0.35,
      instructions:
        input.target === "creativeBible"
          ? [
              "You optimize creative direction for live AI concert visuals.",
              "Expand the user's rough creative bible into a concise, production-ready visual identity.",
              "Keep it specific, venue-safe, cinematic, and useful for downstream image/video prompt generation.",
              "Do not invent brands, celebrities, copyrighted characters, or unsafe themes.",
              "Return only the enhanced creative bible text, no heading or bullets."
            ].join(" ")
          : [
              "You write optimized base prompts for looping AI concert visuals.",
              "Use the full session context to produce one polished base render prompt.",
              "The prompt should describe a loopable Sora-style visual with subject, environment, texture, camera behavior, palette if enabled, motifs if enabled, and motion constraints.",
              "Keep it venue-safe, avoid copyrighted characters, avoid literal performers unless the user explicitly supplied them, and do not include markdown.",
              "Return only the optimized base prompt."
            ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                target: input.target,
                creativeBible: input.creativeBible,
                allowedMotifs: input.allowedMotifsEnabled ? input.allowedMotifs : "",
                bannedTerms: input.bannedTerms,
                colorPalette: input.colorPaletteEnabled ? input.colorPalette : "",
                motionRules: input.motionRules,
                basePrompt: input.basePrompt
              })
            }
          ]
        }
      ]
    });

    const enhancedText = normalizePromptText(response.output_text);

    if (!enhancedText) {
      throw new Error("Empty enhancement response.");
    }

    return NextResponse.json({
      enhancedText
    });
  } catch {
    return NextResponse.json({
      enhancedText: fallbackEnhancement(input)
    });
  }
}

type SessionEnhanceInput = ReturnType<typeof sessionEnhanceSchema.parse>;

function fallbackEnhancement(input: SessionEnhanceInput) {
  if (input.target === "creativeBible") {
    return normalizePromptText(
      [
        input.creativeBible,
        "Develop this into a cohesive live-visual identity with a clear spatial world, repeatable texture language, restrained nightclub energy, and enough specificity for safe crowd-driven remixes.",
        "Favor loopable abstractions, readable silhouettes, and motion that can evolve without becoming chaotic."
      ].join(" ")
    );
  }

  return normalizePromptText(
    [
      input.basePrompt || "A loopable cinematic concert visual",
      input.creativeBible ? `Visual identity: ${input.creativeBible}.` : "",
      input.allowedMotifsEnabled && input.allowedMotifs ? `Use motifs such as ${input.allowedMotifs}.` : "",
      input.colorPaletteEnabled && input.colorPalette ? `Work within a ${input.colorPalette} palette.` : "",
      input.motionRules ? `Motion rules: ${input.motionRules}.` : "",
      input.bannedTerms ? `Avoid ${input.bannedTerms}.` : "",
      "Make it seamless, venue-safe, high contrast, and suitable for a projector or LED wall."
    ].join(" ")
  );
}
