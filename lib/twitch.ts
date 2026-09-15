import { db } from "@/lib/db";
import {
  decryptTwitchToken,
  encryptTwitchToken,
  getTwitchConfig,
  isTwitchConfigured,
  twitchScopes
} from "@/lib/twitch-security";

export { isTwitchConfigured } from "@/lib/twitch-security";
export { drainPendingTwitchEvents } from "@/lib/twitch-events";

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string[] };
type Validation = { client_id: string; user_id: string; login: string; scopes: string[]; expires_in: number };
type Subscription = { id: string; status: string; type: string; condition: { broadcaster_user_id: string; user_id: string }; transport: { method: string; callback?: string } };

class TwitchRequestError extends Error {
  constructor(public readonly status: number) {
    super("Twitch could not complete that request. Try connecting again.");
  }
}

async function twitchRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new TwitchRequestError(response.status);
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function tokenRequest(values: Record<string, string>) {
  const config = getTwitchConfig();
  return twitchRequest<TokenResponse>("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values })
  });
}

async function validateAccessToken(accessToken: string, expectedUserId?: string) {
  const validation = await twitchRequest<Validation>("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` }
  });
  if (validation.client_id !== getTwitchConfig().clientId || !validation.user_id ||
    (expectedUserId && validation.user_id !== expectedUserId) ||
    !twitchScopes.every((scope) => validation.scopes?.includes(scope))) {
    throw new TwitchRequestError(401);
  }
  return validation;
}

async function appHeaders() {
  const token = await tokenRequest({ grant_type: "client_credentials" });
  return { Authorization: `Bearer ${token.access_token}`, "Client-Id": getTwitchConfig().clientId, "Content-Type": "application/json" };
}

export function twitchAuthorizationUrl(state: string) {
  const config = getTwitchConfig();
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: twitchScopes.join(" "), state, force_verify: "true"
  }).toString();
  return url.toString();
}

async function ensureChatSubscription(userId: string, twitchUserId: string) {
  const config = getTwitchConfig();
  const headers = await appHeaders();
  const createSubscription = () => twitchRequest<{ data: Subscription[] }>("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST", headers,
    body: JSON.stringify({
      type: "channel.chat.message", version: "1",
      condition: { broadcaster_user_id: twitchUserId, user_id: twitchUserId },
      transport: { method: "webhook", callback: config.webhookUrl, secret: config.webhookSecret }
    })
  });
  let subscription: Subscription | undefined;
  try {
    const response = await createSubscription();
    subscription = response.data[0];
  } catch (error) {
    if (!(error instanceof TwitchRequestError) || error.status !== 409) throw error;
    // Reconnecting an authorized channel can encounter the existing subscription.
    let cursor: string | undefined;
    do {
      const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
      url.searchParams.set("type", "channel.chat.message");
      if (cursor) url.searchParams.set("after", cursor);
      const response = await twitchRequest<{ data: Subscription[]; pagination?: { cursor?: string } }>(url.toString(), { headers });
      subscription = response.data.find((item) =>
        item.condition.broadcaster_user_id === twitchUserId && item.condition.user_id === twitchUserId &&
        item.transport.method === "webhook" && item.transport.callback === config.webhookUrl &&
        ["enabled", "webhook_callback_verification_pending"].includes(item.status)
      );
      cursor = response.pagination?.cursor;
    } while (!subscription && cursor);
    if (subscription) {
      // Recreate on reconnect so webhook-secret rotations also take effect.
      const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
      url.searchParams.set("id", subscription.id);
      await twitchRequest<void>(url.toString(), { method: "DELETE", headers });
      subscription = (await createSubscription()).data[0];
    }
  }
  if (!subscription) throw new Error("Twitch chat could not be connected. Reconnect your account.");
  // The verification request may arrive before Twitch's create response. Never
  // overwrite an already verified subscription with the pending response.
  const connection = await db.twitchConnection.findUnique({ where: { userId } });
  await db.twitchConnection.update({ where: { userId }, data: {
    subscriptionId: subscription.id,
    subscriptionStatus: connection?.subscriptionId === subscription.id && connection.subscriptionStatus === "enabled"
      ? "enabled" : subscription.status
  } });
}

export async function connectTwitchAccount(userId: string, code: string) {
  if (!isTwitchConfigured()) throw new Error("Twitch mode is not configured on this platform yet.");
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: getTwitchConfig().redirectUri });
  if (!token.access_token || !token.refresh_token) throw new Error("Twitch did not return the required authorization.");
  const validation = await validateAccessToken(token.access_token);
  const identity = await twitchRequest<{ data: Array<{ id: string; login: string; display_name: string }> }>("https://api.twitch.tv/helix/users", {
    headers: { Authorization: `Bearer ${token.access_token}`, "Client-Id": getTwitchConfig().clientId }
  });
  const account = identity.data[0];
  if (!account || account.id !== validation.user_id) throw new Error("Twitch account verification failed.");
  const existingOwner = await db.twitchConnection.findUnique({ where: { twitchUserId: account.id } });
  if (existingOwner && existingOwner.userId !== userId) {
    throw new Error("This Twitch channel is already connected to another Dream Sequence account.");
  }
  const data = {
    twitchUserId: account.id, login: account.login, displayName: account.display_name,
    encryptedAccessToken: encryptTwitchToken(token.access_token, userId),
    encryptedRefreshToken: encryptTwitchToken(token.refresh_token, userId),
    tokenExpiresAt: new Date(Date.now() + validation.expires_in * 1_000),
    tokenValidatedAt: new Date(), scopes: JSON.stringify(validation.scopes),
    subscriptionId: null, subscriptionStatus: "pending"
  };
  await db.twitchConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  try {
    await ensureChatSubscription(userId, account.id);
  } catch (error) {
    await db.twitchConnection.updateMany({ where: { userId, twitchUserId: account.id }, data: { subscriptionStatus: "connection_failed" } });
    throw error;
  }
}

export async function getValidTwitchConnection(userId: string) {
  if (!isTwitchConfigured()) return null;
  const connection = await db.twitchConnection.findUnique({ where: { userId } });
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken ||
    connection.subscriptionStatus === "authorization_revoked") return null;
  if (connection.tokenValidatedAt && Date.now() - connection.tokenValidatedAt.getTime() < 55 * 60_000 &&
    connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return connection;
  try {
    let token: TokenResponse | undefined;
    let validation: Validation;
    try {
      validation = await validateAccessToken(decryptTwitchToken(connection.encryptedAccessToken, userId), connection.twitchUserId);
    } catch (error) {
      if (!(error instanceof TwitchRequestError) || error.status !== 401) throw error;
      token = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptTwitchToken(connection.encryptedRefreshToken, userId) });
      validation = await validateAccessToken(token.access_token, connection.twitchUserId);
    }
    const data = {
      tokenValidatedAt: new Date(), tokenExpiresAt: new Date(Date.now() + validation.expires_in * 1_000),
      scopes: JSON.stringify(validation.scopes),
      ...(token ? {
        encryptedAccessToken: encryptTwitchToken(token.access_token, userId),
        encryptedRefreshToken: encryptTwitchToken(token.refresh_token || decryptTwitchToken(connection.encryptedRefreshToken, userId), userId)
      } : {})
    };
    await db.twitchConnection.updateMany({ where: { id: connection.id, updatedAt: connection.updatedAt }, data });
    return await db.twitchConnection.findUnique({ where: { userId } });
  } catch (error) {
    if (error instanceof TwitchRequestError && [400, 401, 403].includes(error.status)) {
      await db.twitchConnection.updateMany({ where: { id: connection.id, updatedAt: connection.updatedAt }, data: {
        subscriptionStatus: "authorization_revoked", encryptedAccessToken: "", encryptedRefreshToken: ""
      } });
      return null;
    }
    throw error;
  }
}

export async function getTwitchConnectionStatus(userId: string) {
  const configured = isTwitchConfigured();
  if (!configured) return { configured: false, connected: false, login: null, displayName: null, subscriptionStatus: null };
  let connection = await getValidTwitchConnection(userId);
  // Challenge responses can be lost or a subscription can be disabled by Twitch.
  // Reconcile its status while setup is waiting for confirmation.
  if (connection?.subscriptionId && ["pending", "webhook_callback_verification_pending"].includes(connection.subscriptionStatus)) {
    const headers = await appHeaders();
    const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
    url.searchParams.set("subscription_id", connection.subscriptionId);
    const response = await twitchRequest<{ data: Subscription[] }>(url.toString(), { headers });
    const subscription = response.data.find((item) => item.id === connection?.subscriptionId);
    const subscriptionStatus = subscription?.status ?? "connection_failed";
    if (subscriptionStatus !== connection.subscriptionStatus) {
      connection = await db.twitchConnection.update({ where: { userId }, data: { subscriptionStatus } });
    }
  }
  return {
    configured, connected: connection?.subscriptionStatus === "enabled",
    login: connection?.login ?? null, displayName: connection?.displayName ?? null,
    subscriptionStatus: connection?.subscriptionStatus ?? null
  };
}

export async function validateTwitchConnections() {
  if (!isTwitchConfigured()) return { validated: 0, failed: 0 };
  const connections = await db.twitchConnection.findMany({
    where: { subscriptionStatus: "enabled", OR: [ { tokenValidatedAt: null }, { tokenValidatedAt: { lt: new Date(Date.now() - 55 * 60_000) } } ] },
    orderBy: { tokenValidatedAt: "asc" }, take: 50, select: { userId: true }
  });
  let validated = 0;
  let failed = 0;
  // Batches keep provider requests bounded even when Twitch is slow.
  for (let index = 0; index < connections.length; index += 5) {
    const results = await Promise.allSettled(connections.slice(index, index + 5).map((connection) => getValidTwitchConnection(connection.userId)));
    for (const result of results) result.status === "fulfilled" ? validated++ : failed++;
  }
  return { validated, failed };
}

export async function disconnectTwitchAccount(userId: string) {
  const connection = await db.twitchConnection.findUnique({ where: { userId } });
  if (!connection) return { connected: false as const, revokeAtTwitch: false };
  // Stop local intake before attempting external cleanup. Provider availability
  // must never prevent the owner from disconnecting their channel here.
  await db.twitchConnection.delete({ where: { userId } });
  await db.twitchEventDelivery.updateMany({ where: {
    channelId: connection.twitchUserId, status: { in: ["pending", "processing"] }
  }, data: { status: "discarded", processedAt: new Date(), leaseUntil: null, payload: "{}" } });
  const cleanup = await Promise.allSettled([
    (async () => {
      if (!connection.subscriptionId) return;
      const headers = await appHeaders();
      const url = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
      url.searchParams.set("id", connection.subscriptionId);
      try { await twitchRequest<void>(url.toString(), { method: "DELETE", headers }); }
      catch (error) { if (!(error instanceof TwitchRequestError) || error.status !== 404) throw error; }
    })(),
    (async () => {
      if (!connection.encryptedAccessToken) return;
      await twitchRequest<void>("https://id.twitch.tv/oauth2/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: getTwitchConfig().clientId, token: decryptTwitchToken(connection.encryptedAccessToken, userId) })
      });
    })()
  ]);
  return { connected: false as const, revokeAtTwitch: cleanup.some((result) => result.status === "rejected") };
}
