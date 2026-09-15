import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getStoredRenderProgress: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findUnique
    }
  }
}));

vi.mock("@/lib/render-progress-state", () => ({
  getStoredRenderProgress: mocks.getStoredRenderProgress,
  renderProgressEventPrefix: "render.progress."
}));

vi.mock("@/lib/show-overlay-state", () => ({
  getShowOverlaySettings: () => ({
    qrOverlayVisible: false,
    wordmarkOverlayVisible: false,
    wordmarkOpacity: 1,
    wordmarkSize: 1,
    wordmarkAudioReactiveOnly: false,
    progressOverlayVisible: false
  }),
  showOverlayEventTypes: ["show.overlay.test"]
}));

import { getSessionSnapshot } from "@/lib/snapshot";
import { maximumEstimatedVideoProgress } from "@/lib/render-progress";
import {
  videoModerationBlockedReason,
  videoProviderFailureReason
} from "@/lib/video-moderation";

describe("client session snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoredRenderProgress.mockReturnValue(37);
  });

  it("exposes only a recovery boolean and safe explanation for the latest completed-provider seed", async () => {
    const job = { id: "seed-latest", mode: "seed", status: "failed", submissionId: null,
      providerStrategy: "fal_text_to_video", providerRequestId: "private-request-id", providerOutputUri: "https://private-provider/video.mp4",
      outputAsset: { status: "failed" }, failureReason: "Private native loader trace", providerFailureCode: null,
      promptText: "A fox finds a door", createdAt: new Date() };
    mocks.findUnique.mockResolvedValue({ id: "session-1", userId: "user-1", playbackState: null, submissions: [], visualAssets: [], auditEvents: [],
      renderJobs: [job, { ...job, id: "seed-superseded" }] });
    const snapshot = await getSessionSnapshot("session-1");
    expect(snapshot?.session.renderJobs[0]).toMatchObject({
      canRecover: true,
      failureReason: "The video finished generating, but could not be prepared for playback. Recover the existing clip."
    });
    expect(snapshot?.session.renderJobs[1].canRecover).toBe(false);
    const serialized = JSON.stringify(snapshot);
    for (const privateValue of ["private-request-id", "private-provider", "Private native loader trace", "providerRequestId", "providerOutputUri", "outputAsset", "providerStrategy"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("redacts participant identifiers while preserving web attribution", async () => {
    const createdAt = new Date("2026-07-28T12:00:00.000Z");
    const smsSourceSubmission = {
      rawText: "Add violet lightning",
      sender: "+13125550123",
      senderFingerprint: "device-hash-private",
      messageSid: "SM-private-message",
      source: "sms",
      referenceImageUrl: null
    };
    const webSourceSubmission = {
      rawText: "Turn the skyline into liquid chrome",
      sender: "NeonGhost",
      senderFingerprint: "web-device-hash-private",
      messageSid: null,
      source: "web",
      referenceImageUrl: null
    };
    const createAsset = (
      id: string,
      sourceSubmission: typeof smsSourceSubmission | typeof webSourceSubmission
    ) => ({
      id,
      kind: "remix",
      title: "DREAM SEQUENCE",
      promptText: sourceSubmission.rawText,
      publicUrl: `https://example.com/${id}.mp4`,
      storagePath: `private/${id}.mp4`,
      sourceVideoId: "provider-video-private",
      status: "live",
      createdAt,
      sourceSubmission
    });
    const smsAsset = createAsset("asset-sms", smsSourceSubmission);
    const webAsset = createAsset("asset-web", webSourceSubmission);

    mocks.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      name: "Live Set",
      status: "live",
      playbackState: {
        id: "playback-1",
        status: "live",
        crossfadeSeconds: 2,
        currentAsset: smsAsset,
        nextAsset: webAsset,
        fallbackAsset: smsAsset
      },
      submissions: [
        {
          id: "submission-sms",
          source: "sms",
          sender: "+13125550999",
          senderFingerprint: "submission-device-hash-private",
          messageSid: "SM-private-submission",
          rawText: "Add violet lightning",
          referenceImageUrl: null,
          status: "approved",
          approvalReason: "Safe",
          createdAt,
          moderationResult: {
            id: "moderation-private",
            submissionId: "submission-sms"
          },
          rankingResult: {
            id: "ranking-private",
            submissionId: "submission-sms",
            score: 92,
            winningPrompt: "Add violet lightning"
          }
        },
        {
          id: "submission-web",
          source: "web",
          sender: "NeonGhost",
          senderFingerprint: "web-submission-device-hash-private",
          messageSid: null,
          rawText: "Turn the skyline into liquid chrome",
          referenceImageUrl: null,
          status: "ready",
          approvalReason: "Safe",
          createdAt,
          moderationResult: null,
          rankingResult: {
            id: "web-ranking-private",
            submissionId: "submission-web",
            score: 96,
            winningPrompt: "Turn the skyline into liquid chrome"
          }
        }
      ],
      renderJobs: [
        {
          id: "render-1",
          mode: "remix",
          status: "in_progress",
          promptText: "Add violet lightning",
          failureReason: `${videoModerationBlockedReason} Raw provider detail must stay private.`,
          providerFailureCode: "SAFETY.INPUT.IMAGE",
          createdAt,
          providerRequestId: "interaction-private",
          providerOutputUri: "provider-uri-private",
          submission: {
            sender: "+13125550123",
            senderFingerprint: "render-device-hash-private",
            messageSid: "SM-render-private"
          }
        },
        {
          id: "render-2",
          mode: "remix",
          status: "failed",
          promptText: "Turn the skyline into liquid chrome",
          failureReason:
            "Gemini video request failed: Raw invalid argument detail. (INVALID_ARGUMENT)",
          providerFailureCode: "INVALID_ARGUMENT",
          createdAt
        }
      ],
      visualAssets: [smsAsset, webAsset],
      auditEvents: []
    });

    const snapshot = await getSessionSnapshot("session-1");

    expect(snapshot?.session.playbackState?.currentAsset?.sourceSubmission?.sender).toBeNull();
    expect(snapshot?.session.playbackState?.nextAsset?.sourceSubmission?.sender).toBe(
      "NeonGhost"
    );
    expect(snapshot?.session.visualAssets[0]?.sourceSubmission?.sender).toBeNull();
    expect(snapshot?.session.visualAssets[1]?.sourceSubmission?.sender).toBe("NeonGhost");
    expect(snapshot?.session.submissions[0]?.sender).toBeNull();
    expect(snapshot?.session.submissions[1]?.sender).toBe("NeonGhost");
    expect(snapshot?.session.renderJobs[0]?.progress).toBe(
      maximumEstimatedVideoProgress
    );
    expect(snapshot?.session.renderJobs[0]?.moderationDiagnostic).toBe(
      "input_image"
    );
    expect(snapshot?.session.renderJobs[0]?.failureReason).toBe(
      videoModerationBlockedReason
    );
    expect(snapshot?.session.renderJobs[1]?.moderationDiagnostic).toBeNull();
    expect(snapshot?.session.renderJobs[1]?.failureReason).toBe(
      videoProviderFailureReason
    );

    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("+13125550123");
    expect(serialized).not.toContain("+13125550999");
    expect(serialized).not.toContain("senderFingerprint");
    expect(serialized).not.toContain("messageSid");
    expect(serialized).not.toContain("device-hash-private");
    expect(serialized).not.toContain("SM-private");
    expect(serialized).not.toContain("providerRequestId");
    expect(serialized).not.toContain("providerOutputUri");
    expect(serialized).not.toContain("providerFailureCode");
    expect(serialized).not.toContain("SAFETY.INPUT.IMAGE");
    expect(serialized).not.toContain("Raw provider detail must stay private");
    expect(serialized).not.toContain("Raw invalid argument detail");
    expect(serialized).not.toContain("INVALID_ARGUMENT");
    expect(serialized).not.toContain("interaction-private");
    expect(serialized).not.toContain("provider-uri-private");
    expect(serialized).not.toContain("moderationResult");
    expect(serialized).not.toContain('"submission"');

    const query = mocks.findUnique.mock.calls[0]?.[0];

    expect(query.include.submissions.select).not.toHaveProperty("senderFingerprint");
    expect(query.include.submissions.select).not.toHaveProperty("messageSid");
    expect(query.include.renderJobs.select).not.toHaveProperty("submission");
    expect(query.include.renderJobs.select).toHaveProperty("providerRequestId", true);
    expect(query.include.renderJobs.select).toHaveProperty(
      "providerFailureCode",
      true
    );
  });
});
