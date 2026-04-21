import { env } from "@/lib/env";

export type OpenAiConnectionStatus = {
  configured: boolean;
  source: "env" | "none";
  last4: string | null;
};

function maskLast4(apiKey: string | null | undefined) {
  if (!apiKey) {
    return null;
  }

  return apiKey.slice(-4);
}

export async function getEffectiveOpenAiApiKeyForUser(_userId: string) {
  return env.openAiApiKey || null;
}

export async function getOpenAiConnectionStatusForUser(_userId: string): Promise<OpenAiConnectionStatus> {
  if (env.openAiApiKey) {
    return {
      configured: true,
      source: "env",
      last4: maskLast4(env.openAiApiKey)
    };
  }

  return {
    configured: false,
    source: "none",
    last4: null
  };
}

export async function getOpenAiConnectionStatusForSession(sessionId: string) {
  return getOpenAiConnectionStatusForUser(sessionId);
}
