import { z } from "zod";
import { db } from "@/lib/db";
import { attemptAutomatedSelection, ingestSubmission } from "@/lib/submission-pipeline";
import { getValidTwitchConnection } from "@/lib/twitch";
import { isTwitchConfigured, parseTwitchContinuation } from "@/lib/twitch-security";

export const twitchEventSchema = z.object({
  challenge: z.string().optional(),
  subscription: z.object({
    id: z.string().min(1), type: z.literal("channel.chat.message"), version: z.literal("1"),
    status: z.string(),
    condition: z.object({ broadcaster_user_id: z.string().min(1), user_id: z.string().min(1) })
  }),
  event: z.object({
    broadcaster_user_id: z.string().min(1), chatter_user_id: z.string().min(1),
    chatter_user_login: z.string().min(1), chatter_user_name: z.string(),
    message_id: z.string().min(1).max(200), message: z.object({ text: z.string() }),
    source_broadcaster_user_id: z.string().nullable().optional()
  }).optional()
});

const inboxPayloadSchema = z.object({
  userId: z.string(), sessionId: z.string(), sessionCode: z.string(), channelId: z.string(),
  prompt: z.string().min(1).max(1_000), senderId: z.string(), senderName: z.string(), messageId: z.string()
});

export async function acceptTwitchChatEvent(deliveryId: string, rawPayload: unknown, sentAt: Date) {
  const parsed = twitchEventSchema.safeParse(rawPayload);
  if (!parsed.success || !parsed.data.event) return false;
  const { event, subscription } = parsed.data;
  if (subscription.condition.broadcaster_user_id !== event.broadcaster_user_id ||
    subscription.condition.user_id !== event.broadcaster_user_id ||
    (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== event.broadcaster_user_id)) return false;
  const prompt = parseTwitchContinuation(event.message.text);
  if (!prompt) return false;
  const connection = await db.twitchConnection.findUnique({ where: { twitchUserId: event.broadcaster_user_id } });
  if (!connection || connection.subscriptionId !== subscription.id || connection.subscriptionStatus !== "enabled") return false;
  const session = await db.dJSession.findFirst({
    where: {
      userId: connection.userId, audienceMode: "twitch", twitchChannel: connection.login,
      status: "live", startedAt: { lte: sentAt }
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { id: true, code: true }
  });
  if (!session) return false;
  const payload = {
    userId: connection.userId, sessionId: session.id, sessionCode: session.code,
    channelId: event.broadcaster_user_id, prompt, senderId: event.chatter_user_id,
    senderName: event.chatter_user_name || event.chatter_user_login, messageId: event.message_id
  };
  try {
    await db.twitchEventDelivery.create({ data: { id: deliveryId, channelId: event.broadcaster_user_id, payload: JSON.stringify(payload) } });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    // An existing inbox entry is also an acknowledgement of this delivery.
  }
  return true;
}

export async function drainPendingTwitchEvents(options: { userId?: string; limit?: number } = {}) {
  if (!isTwitchConfigured()) return { processed: 0 };
  const limit = Math.min(10, Math.max(1, options.limit ?? 5));
  let channelId: string | undefined;
  if (options.userId) {
    const connection = await getValidTwitchConnection(options.userId);
    if (connection?.subscriptionStatus !== "enabled") return { processed: 0 };
    channelId = connection.twitchUserId;
  }
  const now = new Date();
  const due = {
    ...(channelId ? { channelId } : {}),
    status: { in: ["pending", "processing"] }, attempts: { lt: 5 },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }]
  };
  const deliveries = await db.twitchEventDelivery.findMany({ where: due, orderBy: { receivedAt: "asc" }, take: limit });
  let processed = 0;
  const selectionSessions = new Set<string>();
  const intakeDeadline = Date.now() + 40_000;
  for (const delivery of deliveries) {
    // Leave unclaimed messages available to another worker when this batch has
    // used its intake budget. Video preparation happens after receipts are saved.
    if (Date.now() >= intakeDeadline) break;
    const claim = await db.twitchEventDelivery.updateMany({
      where: { ...due, id: delivery.id },
      data: { status: "processing", leaseUntil: new Date(Date.now() + 90_000), attempts: { increment: 1 } }
    });
    if (claim.count !== 1) continue;
    try {
      const input = inboxPayloadSchema.parse(JSON.parse(delivery.payload));
      const connection = await getValidTwitchConnection(input.userId);
      const session = connection?.subscriptionStatus === "enabled" && connection.twitchUserId === input.channelId
        ? await db.dJSession.findFirst({ where: {
          id: input.sessionId, userId: input.userId, status: "live", audienceMode: "twitch", twitchChannel: connection.login
        }, select: { code: true } }) : null;
      if (session) {
        const result = await ingestSubmission({
          sessionCode: session.code, source: "twitch", prompt: input.prompt, sender: input.senderName,
          senderFingerprintSeed: `twitch:${input.senderId}`, messageSid: `twitch:${input.channelId}:${input.messageId}`
        }, {
          scheduleSelection: (sessionId) => { selectionSessions.add(sessionId); }
        });
        // A retried delivery may already have a saved receipt. Wake selection
        // for it too, without submitting the same idea again.
        if (result.status === "approved") selectionSessions.add(input.sessionId);
      }
      await db.twitchEventDelivery.update({ where: { id: delivery.id }, data: {
        status: session ? "processed" : "discarded", processedAt: new Date(), leaseUntil: null, lastError: null,
        payload: "{}"
      } });
      processed += 1;
    } catch (error) {
      console.warn("[twitch-intake] delivery will retry", {
        deliveryId: delivery.id,
        attempt: delivery.attempts + 1,
        errorClass: error instanceof Error ? error.name : "UnknownError"
      });
      await db.twitchEventDelivery.update({ where: { id: delivery.id }, data: {
        status: delivery.attempts >= 4 ? "failed" : "pending", leaseUntil: new Date(Date.now() + 30_000),
        lastError: "The story queue could not process this event."
      } });
    }
  }
  // Keep replay IDs longer than the accepted signature window; discard chat text
  // immediately after processing and prune old terminal receipts opportunistically.
  await db.twitchEventDelivery.deleteMany({ where: {
    status: { in: ["processed", "discarded"] }, receivedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) }
  } });
  await Promise.all([...selectionSessions].map(async (sessionId) => {
    try {
      await attemptAutomatedSelection(sessionId);
    } catch (error) {
      // Accepted messages remain approved and can be selected by reconciliation.
      console.warn("[twitch-intake] render selection will retry", {
        sessionId,
        errorClass: error instanceof Error ? error.name : "UnknownError"
      });
    }
  }));
  return { processed };
}
