import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findConnection: vi.fn(), findSession: vi.fn(), createDelivery: vi.fn(), findDeliveries: vi.fn(),
  claimDelivery: vi.fn(), updateDelivery: vi.fn(), deleteDeliveries: vi.fn(), validConnection: vi.fn(), ingest: vi.fn(), select: vi.fn()
}));
vi.mock("@/lib/db", () => ({ db: {
  twitchConnection: { findUnique: mocks.findConnection }, dJSession: { findFirst: mocks.findSession },
  twitchEventDelivery: { create: mocks.createDelivery, findMany: mocks.findDeliveries, updateMany: mocks.claimDelivery, update: mocks.updateDelivery, deleteMany: mocks.deleteDeliveries }
} }));
vi.mock("@/lib/twitch", () => ({ getValidTwitchConnection: mocks.validConnection }));
vi.mock("@/lib/twitch-security", async (original) => ({ ...(await original<typeof import("@/lib/twitch-security")>()), isTwitchConfigured: () => true }));
vi.mock("@/lib/submission-pipeline", () => ({ ingestSubmission: mocks.ingest, attemptAutomatedSelection: mocks.select }));

import { acceptTwitchChatEvent, drainPendingTwitchEvents } from "@/lib/twitch-events";

const connection = { userId: "owner", twitchUserId: "channel-1", login: "streamer", subscriptionId: "sub-1", subscriptionStatus: "enabled" };
const payload = {
  subscription: { id: "sub-1", type: "channel.chat.message", version: "1", status: "enabled", condition: { broadcaster_user_id: "channel-1", user_id: "channel-1" } },
  event: { broadcaster_user_id: "channel-1", chatter_user_id: "viewer-1", chatter_user_login: "viewer", chatter_user_name: "Viewer", message_id: "chat-1", message: { text: "!next A dragon lands." }, source_broadcaster_user_id: null }
};
const inbox = { userId: "owner", sessionId: "story-1", sessionCode: "STORY", channelId: "channel-1", prompt: "A dragon lands.", senderId: "viewer-1", senderName: "Viewer", messageId: "chat-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findConnection.mockResolvedValue(connection);
  mocks.validConnection.mockResolvedValue(connection);
  mocks.findSession.mockResolvedValue({ id: "story-1", code: "STORY" });
  mocks.createDelivery.mockResolvedValue({ id: "delivery-1" });
  mocks.claimDelivery.mockResolvedValue({ count: 1 });
  mocks.findDeliveries.mockResolvedValue([{ id: "delivery-1", payload: JSON.stringify(inbox), attempts: 0 }]);
  mocks.ingest.mockResolvedValue({ status: "approved" });
});

describe("Twitch story intake", () => {
  it("scopes chat to the channel owner and newest live Twitch story at the event timestamp", async () => {
    const sentAt = new Date();
    expect(await acceptTwitchChatEvent("delivery-1", payload, sentAt)).toBe(true);
    expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "owner", audienceMode: "twitch", twitchChannel: "streamer", status: "live", startedAt: { lte: sentAt } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    }));
    const saved = mocks.createDelivery.mock.calls[0][0].data;
    expect(JSON.parse(saved.payload)).toMatchObject(inbox);
  });

  it("ignores ordinary chat, shared-chat messages from other channels, and unknown subscriptions", async () => {
    expect(await acceptTwitchChatEvent("delivery-1", { ...payload, event: { ...payload.event, message: { text: "hi chat" } } }, new Date())).toBe(false);
    expect(await acceptTwitchChatEvent("delivery-1", { ...payload, event: { ...payload.event, source_broadcaster_user_id: "other-channel" } }, new Date())).toBe(false);
    expect(await acceptTwitchChatEvent("delivery-1", { ...payload, subscription: { ...payload.subscription, id: "old-subscription" } }, new Date())).toBe(false);
    expect(mocks.createDelivery).not.toHaveBeenCalled();
  });

  it("acknowledges duplicate deliveries without creating another inbox item", async () => {
    mocks.createDelivery.mockRejectedValueOnce({ code: "P2002" });
    expect(await acceptTwitchChatEvent("delivery-1", payload, new Date())).toBe(true);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("sends a claimed continuation through the existing moderation and render queue", async () => {
    expect(await drainPendingTwitchEvents({ userId: "owner" })).toEqual({ processed: 1 });
    expect(mocks.ingest).toHaveBeenCalledWith({
      sessionCode: "STORY", source: "twitch", prompt: "A dragon lands.", sender: "Viewer",
      senderFingerprintSeed: "twitch:viewer-1", messageSid: "twitch:channel-1:chat-1"
    }, { scheduleSelection: expect.any(Function) });
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "processed", payload: "{}" }) }));
    expect(mocks.select).toHaveBeenCalledWith("story-1");
  });

  it("saves every intake receipt before starting slow video preparation", async () => {
    mocks.findDeliveries.mockResolvedValueOnce([
      { id: "delivery-1", payload: JSON.stringify(inbox), attempts: 0 },
      { id: "delivery-2", payload: JSON.stringify({ ...inbox, messageId: "chat-2" }), attempts: 0 }
    ]);
    let finishSelection!: () => void;
    mocks.select.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSelection = resolve; }));
    const draining = drainPendingTwitchEvents();
    await vi.waitFor(() => expect(mocks.select).toHaveBeenCalledTimes(1));
    expect(mocks.ingest).toHaveBeenCalledTimes(2);
    expect(mocks.updateDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.updateDelivery.mock.calls.every(([call]) => call.data.status === "processed")).toBe(true);
    finishSelection();
    expect(await draining).toEqual({ processed: 2 });
  });

  it("keeps accepted messages processed when video selection fails", async () => {
    mocks.select.mockRejectedValueOnce(new Error("Temporary render setup failure"));
    expect(await drainPendingTwitchEvents()).toEqual({ processed: 1 });
    expect(mocks.updateDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "processed" }) }));
  });

  it("leaves unclaimed messages for another worker when the intake time budget is spent", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      mocks.findDeliveries.mockResolvedValueOnce([
        { id: "delivery-1", payload: JSON.stringify(inbox), attempts: 0 },
        { id: "delivery-2", payload: JSON.stringify({ ...inbox, messageId: "chat-2" }), attempts: 0 }
      ]);
      mocks.ingest.mockImplementationOnce(async () => {
        now.mockReturnValue(141_000);
        return { status: "approved" };
      });
      expect(await drainPendingTwitchEvents()).toEqual({ processed: 1 });
      expect(mocks.claimDelivery).toHaveBeenCalledTimes(1);
      expect(mocks.claimDelivery.mock.calls[0][0].data.leaseUntil).toEqual(new Date(190_000));
    } finally {
      now.mockRestore();
    }
  });

  it("does not ingest a concurrently claimed delivery or move a stopped story's message into another story", async () => {
    mocks.claimDelivery.mockResolvedValueOnce({ count: 0 });
    await drainPendingTwitchEvents();
    expect(mocks.ingest).not.toHaveBeenCalled();
    mocks.findSession.mockResolvedValueOnce(null);
    await drainPendingTwitchEvents();
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "discarded" }) }));
  });

  it("keeps a durable retry after transient processing errors", async () => {
    mocks.ingest.mockRejectedValueOnce(new Error("Temporary database failure"));
    expect(await drainPendingTwitchEvents()).toEqual({ processed: 0 });
    expect(mocks.updateDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending", leaseUntil: expect.any(Date) }) }));
  });
});
