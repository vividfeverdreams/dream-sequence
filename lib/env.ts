function readAuthSecret() {
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }

  // This fallback is public in the repo, so it can't be allowed to sign real sessions.
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production.");
  }

  return "dev-secret-change-me";
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  get authSecret() {
    return readAuthSecret();
  },
  falApiKey: process.env.FAL_KEY ?? "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER ?? "",
  sessionCookieName: "dream-sequence-session"
} as const;

export function hasFalCredentials() {
  return Boolean(env.falApiKey);
}

export function hasTwilioCredentials() {
  return Boolean(env.twilioAccountSid && env.twilioAuthToken);
}
