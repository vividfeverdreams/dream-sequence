import OpenAI from "openai";
import { env, hasOpenAiCredentials } from "@/lib/env";

let singleton: OpenAI | null = null;

export function getOpenAiClient() {
  if (!hasOpenAiCredentials()) {
    return null;
  }

  if (!singleton) {
    singleton = new OpenAI({
      apiKey: env.openAiApiKey
    });
  }

  return singleton;
}
