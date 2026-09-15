import { env } from "@/lib/env";

// Kept as an internal alias for existing dashboard callers.
export type GoogleConnectionStatus = {
  configured: boolean;
  provider: "fal";
  source: "env" | "none";
  last4: string | null;
};

export async function getEffectiveGeminiApiKeyForUser(_userId: string) {
  return env.geminiApiKey || null;
}

export async function getGoogleConnectionStatusForUser(_userId: string): Promise<GoogleConnectionStatus> {
  return {
    configured: Boolean(env.falApiKey),
    provider: "fal",
    source: env.falApiKey ? "env" : "none",
    last4: null
  };
}
