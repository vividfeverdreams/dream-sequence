import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const twitchScopes = ["user:read:chat", "user:bot", "channel:bot"] as const;
export const twitchStateCookie = "dream-sequence-twitch-state";

export function getTwitchConfig() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    appUrl,
    clientId: process.env.TWITCH_CLIENT_ID || "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    webhookSecret: process.env.TWITCH_EVENTSUB_SECRET || "",
    encryptionKey: process.env.TWITCH_TOKEN_ENCRYPTION_KEY || "",
    redirectUri: process.env.TWITCH_REDIRECT_URI || new URL("/api/twitch/callback", appUrl).toString(),
    webhookUrl: new URL("/api/twitch/webhook", appUrl).toString()
  };
}

export function isTwitchConfigured() {
  try {
    const config = getTwitchConfig();
    return Boolean(
      config.clientId && config.clientSecret &&
      /^[\x20-\x7e]{32,100}$/.test(config.webhookSecret) &&
      Buffer.from(config.encryptionKey, "base64").length === 32 &&
      new URL(config.webhookUrl).protocol === "https:" &&
      new URL(config.redirectUri).origin === new URL(config.appUrl).origin
    );
  } catch {
    return false;
  }
}

function encryptionKey() {
  const key = Buffer.from(getTwitchConfig().encryptionKey, "base64");
  if (key.length !== 32) throw new Error("Twitch token encryption is not configured.");
  return key;
}

export function encryptTwitchToken(token: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`twitch:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTwitchToken(value: string, userId: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid Twitch token.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`twitch:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function safeTwitchReturnPath(value: string | null | undefined) {
  return value === "/dashboard" ? value : "/dashboard/new";
}

export function createTwitchOAuthState(userId: string, returnTo: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    userId, returnTo: safeTwitchReturnPath(returnTo), nonce: randomBytes(32).toString("base64url"),
    expiresAt: now + 10 * 60_000
  })).toString("base64url");
  const signature = createHmac("sha256", encryptionKey()).update(`oauth:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function equalTwitchSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function validateTwitchOAuthState(state: string | null, cookie: string | undefined, userId: string, now = Date.now()) {
  if (!state || !cookie || !equalTwitchSecret(state, cookie)) return null;
  try {
    const [payload, signature, extra] = state.split(".");
    if (!payload || !signature || extra) return null;
    const expected = createHmac("sha256", encryptionKey()).update(`oauth:${payload}`).digest("base64url");
    if (!equalTwitchSecret(signature, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.userId !== userId || typeof decoded.nonce !== "string" || decoded.nonce.length < 32 ||
      !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= now || decoded.expiresAt > now + 10 * 60_000) return null;
    return { returnTo: safeTwitchReturnPath(decoded.returnTo) };
  } catch {
    return null;
  }
}

export function verifyTwitchWebhook(input: { body: string; headers: Headers; secret: string; now?: number }) {
  const messageId = input.headers.get("twitch-eventsub-message-id");
  const timestamp = input.headers.get("twitch-eventsub-message-timestamp");
  const signature = input.headers.get("twitch-eventsub-message-signature");
  if (!messageId || messageId.length > 200 || !timestamp || !signature || !input.secret) return false;
  const sentAt = Date.parse(timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(sentAt) || sentAt < now - 10 * 60_000 || sentAt > now + 60_000) return false;
  const expected = `sha256=${createHmac("sha256", input.secret).update(messageId + timestamp + input.body).digest("hex")}`;
  return equalTwitchSecret(expected, signature);
}

export function parseTwitchContinuation(text: unknown) {
  if (typeof text !== "string") return null;
  const match = /^!next\s+([\s\S]+)$/i.exec(text.trim());
  const prompt = match?.[1].trim();
  return prompt && prompt.length <= 1_000 ? prompt : null;
}
