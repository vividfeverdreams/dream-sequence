export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiTextModel: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.4-mini",
  falApiKey: process.env.FAL_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiPromptModel: process.env.GEMINI_PROMPT_MODEL ?? "gemini-3.6-flash",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  sessionCookieName: "dream-sequence-session"
} as const;

export function hasOpenAiCredentials() {
  return Boolean(env.openAiApiKey);
}

export function hasGeminiCredentials() {
  return Boolean(env.geminiApiKey);
}

export function hasFalCredentials() {
  return Boolean(env.falApiKey);
}

export function hasTwilioCredentials() {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken);
}
