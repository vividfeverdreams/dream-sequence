const defaultDatabasePath = "file:./prisma/dev.db";

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? defaultDatabasePath,
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiTextModel: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.4-mini",
  openAiVideoModel: process.env.OPENAI_VIDEO_MODEL ?? "sora-2",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? "587"),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  smtpFrom: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  smtpSecure: process.env.SMTP_SECURE === "true",
  sessionCookieName: "crowd-remix-session"
} as const;

export function hasOpenAiCredentials() {
  return Boolean(env.openAiApiKey);
}

export function hasTwilioCredentials() {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken);
}

export function hasSmtpCredentials() {
  return Boolean(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPassword && env.smtpFrom);
}
