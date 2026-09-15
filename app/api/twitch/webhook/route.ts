import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { acceptTwitchChatEvent, drainPendingTwitchEvents, twitchEventSchema } from "@/lib/twitch-events";
import { getTwitchConfig, isTwitchConfigured, verifyTwitchWebhook } from "@/lib/twitch-security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isTwitchConfigured()) return new NextResponse(null, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 64_000) return new NextResponse(null, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 64_000) return new NextResponse(null, { status: 413 });
  if (!verifyTwitchWebhook({ body, headers: request.headers, secret: getTwitchConfig().webhookSecret })) {
    return new NextResponse(null, { status: 403 });
  }
  let rawPayload: unknown;
  try { rawPayload = JSON.parse(body); } catch { return new NextResponse(null, { status: 400 }); }
  const payload = twitchEventSchema.safeParse(rawPayload);
  if (!payload.success) return new NextResponse(null, { status: 400 });
  const { subscription } = payload.data;
  if (subscription.condition.broadcaster_user_id !== subscription.condition.user_id) return new NextResponse(null, { status: 403 });
  const messageType = request.headers.get("twitch-eventsub-message-type");
  if (messageType === "webhook_callback_verification" && payload.data.challenge) {
    await db.twitchConnection.updateMany({ where: {
      twitchUserId: subscription.condition.broadcaster_user_id,
      OR: [{ subscriptionId: null }, { subscriptionId: subscription.id }]
    }, data: { subscriptionId: subscription.id, subscriptionStatus: "webhook_callback_verification_pending" } });
    return new NextResponse(payload.data.challenge, { headers: { "Content-Type": "text/plain" } });
  }
  if (messageType === "revocation") {
    await db.twitchConnection.updateMany({ where: {
      twitchUserId: subscription.condition.broadcaster_user_id, subscriptionId: subscription.id
    }, data: {
      subscriptionStatus: subscription.status,
      ...(subscription.status === "authorization_revoked" ? { encryptedAccessToken: "", encryptedRefreshToken: "" } : {})
    } });
    return new NextResponse(null, { status: 204 });
  }
  if (messageType !== "notification") return new NextResponse(null, { status: 204 });
  const accepted = await acceptTwitchChatEvent(
    request.headers.get("twitch-eventsub-message-id")!, payload.data,
    new Date(request.headers.get("twitch-eventsub-message-timestamp")!)
  );
  if (accepted) after(async () => { await drainPendingTwitchEvents({ limit: 5 }); });
  return new NextResponse(null, { status: 204 });
}
