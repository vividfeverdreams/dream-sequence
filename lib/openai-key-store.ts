import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export type OpenAiConnectionStatus = {
  configured: boolean;
  source: "account" | "env" | "none";
  last4: string | null;
};

const encryptionVersion = "v1";

function maskLast4(apiKey: string | null | undefined) {
  if (!apiKey) {
    return null;
  }

  return apiKey.slice(-4);
}

function getEncryptionKey() {
  return createHash("sha256").update(env.authSecret).digest();
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    encryptionVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

function decryptSecret(payload: string | null | undefined) {
  if (!payload) {
    return null;
  }

  const [version, iv, authTag, encrypted] = payload.split(":");

  if (version !== encryptionVersion || !iv || !authTag || !encrypted) {
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export async function getEffectiveOpenAiApiKeyForUser(userId: string) {
  const user = await db.user.findUnique({
    where: {
      id: userId
    },
    select: {
      openAiApiKeyEncrypted: true
    }
  });

  const accountKey = decryptSecret(user?.openAiApiKeyEncrypted);

  if (accountKey) {
    return accountKey;
  }

  return env.openAiApiKey || null;
}

export async function getOpenAiConnectionStatusForUser(userId: string): Promise<OpenAiConnectionStatus> {
  const user = await db.user.findUnique({
    where: {
      id: userId
    },
    select: {
      openAiApiKeyEncrypted: true,
      openAiApiKeyLast4: true
    }
  });

  if (decryptSecret(user?.openAiApiKeyEncrypted)) {
    return {
      configured: true,
      source: "account",
      last4: user?.openAiApiKeyLast4 ? String(user.openAiApiKeyLast4) : null
    };
  }

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

export async function saveOpenAiApiKeyForUser(userId: string, apiKey: string) {
  const trimmedApiKey = apiKey.trim();

  await db.user.update({
    where: {
      id: userId
    },
    data: {
      openAiApiKeyEncrypted: encryptSecret(trimmedApiKey),
      openAiApiKeyLast4: maskLast4(trimmedApiKey)
    }
  });

  return getOpenAiConnectionStatusForUser(userId);
}

export async function clearOpenAiApiKeyForUser(userId: string) {
  await db.user.update({
    where: {
      id: userId
    },
    data: {
      openAiApiKeyEncrypted: null,
      openAiApiKeyLast4: null
    }
  });

  return getOpenAiConnectionStatusForUser(userId);
}

export async function getOpenAiConnectionStatusForSession(sessionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    }
  });

  if (!session?.userId) {
    return {
      configured: Boolean(env.openAiApiKey),
      source: env.openAiApiKey ? "env" : "none",
      last4: maskLast4(env.openAiApiKey)
    } satisfies OpenAiConnectionStatus;
  }

  return getOpenAiConnectionStatusForUser(String(session.userId));
}
