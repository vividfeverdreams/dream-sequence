import twilio from "twilio";
import { env, hasTwilioCredentials } from "@/lib/env";

export function validateTwilioSignature(
  url: string,
  signature: string | null,
  params: Record<string, string>
) {
  if (!hasTwilioCredentials() || !signature) {
    return false;
  }

  return twilio.validateRequest(env.twilioAuthToken, signature, url, params);
}

export function emptyTwiMl() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export function successTwiMl(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
}

function escapeXml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
