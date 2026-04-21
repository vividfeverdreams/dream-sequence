import OpenAI from "openai";
import { env } from "@/lib/env";

const clients = new Map<string, OpenAI>();

export function getOpenAiClient(apiKey?: string | null) {
  const resolvedApiKey = apiKey?.trim() || env.openAiApiKey;

  if (!resolvedApiKey) {
    return null;
  }

  if (!clients.has(resolvedApiKey)) {
    clients.set(
      resolvedApiKey,
      new OpenAI({
        apiKey: resolvedApiKey
      })
    );
  }

  return clients.get(resolvedApiKey) ?? null;
}
