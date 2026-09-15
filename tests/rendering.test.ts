import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    renderJob: { updateMany: vi.fn() },
    visualAsset: { update: vi.fn() },
    playbackState: { updateMany: vi.fn() },
    promptSubmission: { update: vi.fn() }
  };
  return {
    tx,
    db: { renderJob: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() }, $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) },
    startFalVideoRender: vi.fn(), retrieveFalVideoStatus: vi.fn(), retrieveFalVideoResult: vi.fn(), downloadFalVideo: vi.fn(),
    persistVideoAsset: vi.fn(), readVideoMetadata: vi.fn(), promoteOldestReadyAsset: vi.fn(),
    recordRenderJobProgress: vi.fn(async (_session: string, _job: string, value: number) => value),
    env: { falApiKey: "test-fal-key" }
  };
});
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/storage", () => ({ persistVideoAsset: mocks.persistVideoAsset }));
vi.mock("@/lib/video-closing-frame", () => ({ readVideoMetadata: mocks.readVideoMetadata }));
vi.mock("@/lib/playback-queue", () => ({ promoteOldestReadyAsset: mocks.promoteOldestReadyAsset }));
vi.mock("@/lib/render-progress-state", () => ({ recordRenderJobProgress: mocks.recordRenderJobProgress }));
vi.mock("@/lib/fal-video", async (original) => ({ ...await original<typeof import("@/lib/fal-video")>(), startFalVideoRender: mocks.startFalVideoRender, retrieveFalVideoStatus: mocks.retrieveFalVideoStatus, retrieveFalVideoResult: mocks.retrieveFalVideoResult, downloadFalVideo: mocks.downloadFalVideo }));
import { FalApiError } from "@/lib/fal-video";
import { failRenderJob, reconcileRenderJob, startVideoRender, videoModerationBlockedReason } from "@/lib/rendering";

const job = (overrides = {}) => ({
  id: "render-1", sessionId: "session-1", submissionId: "submission-1", outputAssetId: "asset-1",
  outputAsset: { id: "asset-1" }, providerRequestId: "request-1", providerStrategy: "fal_image_to_video",
  providerOutputUri: null, status: "in_progress", createdAt: new Date(),
  session: { playbackState: { id: "playback-1", currentAssetId: "previous" } }, ...overrides
});

describe("fal render lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.falApiKey = "test-fal-key";
    mocks.db.renderJob.findUnique.mockImplementation(async () => job());
    mocks.db.renderJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.renderJob.count.mockResolvedValue(0);
    mocks.tx.renderJob.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.playbackState.updateMany.mockResolvedValue({ count: 0 });
    mocks.promoteOldestReadyAsset.mockResolvedValue("asset-1");
    mocks.retrieveFalVideoStatus.mockResolvedValue({ status: "COMPLETED", request_id: "request-1" });
    mocks.retrieveFalVideoResult.mockResolvedValue("https://v3.fal.media/output.mp4");
    mocks.downloadFalVideo.mockResolvedValue(Buffer.from("video"));
    mocks.readVideoMetadata.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 12 });
    mocks.persistVideoAsset.mockResolvedValue({ publicUrl: "https://storage.example.com/clip.mp4", storagePath: "renders/clip.mp4", thumbnailUrl: "https://storage.example.com/final.jpg" });
  });

  it("routes both first and subsequent clips only to fal", async () => {
    mocks.startFalVideoRender.mockResolvedValue({ requestId: "request-1", strategy: "fal_image_to_video" });
    expect(await startVideoRender({ mode: "remix", prompt: "The door opens", sourceVideoUrl: "https://storage.example.com/previous.mp4", durationSeconds: 12, resolution: "1080P", videoModel: "h3_max" })).toEqual({ kind: "live", requestId: "request-1", strategy: "fal_image_to_video", outputUri: null });
    expect(mocks.startFalVideoRender).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "test-fal-key", durationSeconds: 12, resolution: "1080P", model: "h3_max" }));
  });

  it("stores completed MP4s and their actual dimensions before advancing playback", async () => {
    expect(await reconcileRenderJob("render-1")).toEqual({ status: "completed", progress: 100 });
    expect(mocks.persistVideoAsset).toHaveBeenCalledWith("asset-1", Buffer.from("video"));
    expect(mocks.tx.visualAsset.update).toHaveBeenCalledWith({ where: { id: "asset-1" }, data: expect.objectContaining({ status: "ready", width: 1920, height: 1080, durationSeconds: 12, publicUrl: "https://storage.example.com/clip.mp4", thumbnailUrl: "https://storage.example.com/final.jpg", sourceVideoId: "request-1" }) });
    expect(mocks.promoteOldestReadyAsset).toHaveBeenCalledWith("session-1", mocks.tx, { allowArchivedRotation: false });
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "ready" } });
  });

  it.each(["IN_QUEUE", "IN_PROGRESS"])("reports progress while fal is %s without requesting a new clip", async (status) => {
    mocks.retrieveFalVideoStatus.mockResolvedValue({ status, request_id: "request-1" });
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: status === "IN_QUEUE" ? "queued" : "in_progress" });
    expect(mocks.retrieveFalVideoResult).not.toHaveBeenCalled();
    expect(mocks.persistVideoAsset).not.toHaveBeenCalled();
    expect(mocks.startFalVideoRender).not.toHaveBeenCalled();
  });

  it("retries transient polling errors against the same request", async () => {
    mocks.retrieveFalVideoStatus.mockRejectedValueOnce(new FalApiError("Unavailable", { status: 503 }));
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "in_progress" });
    expect(mocks.tx.renderJob.updateMany).not.toHaveBeenCalled();
    expect(mocks.startFalVideoRender).not.toHaveBeenCalled();
  });

  it("retries persistence directly from a saved result URL", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ providerOutputUri: "https://v3.fal.media/output.mp4" }));
    await reconcileRenderJob("render-1");
    expect(mocks.retrieveFalVideoStatus).not.toHaveBeenCalled();
    expect(mocks.retrieveFalVideoResult).not.toHaveBeenCalled();
    expect(mocks.downloadFalVideo).toHaveBeenCalledWith("https://v3.fal.media/output.mp4");
  });

  it("rejects provider moderation without requeuing the story prompt", async () => {
    mocks.retrieveFalVideoStatus.mockRejectedValueOnce(new FalApiError("Blocked", { status: 422, code: "content_policy_violation" }));
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "failed" });
    expect(mocks.tx.renderJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureReason: videoModerationBlockedReason, providerFailureCode: "content_policy_violation" }) }));
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "rejected", selectedAt: null, approvalReason: videoModerationBlockedReason } });
  });

  it("fails honestly when fal credentials are absent", async () => {
    mocks.env.falApiKey = "";
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "failed" });
    expect(mocks.downloadFalVideo).not.toHaveBeenCalled();
    expect(mocks.persistVideoAsset).not.toHaveBeenCalled();
  });

  it("retires stale jobs and limits each submission to one recovery attempt", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ createdAt: new Date(Date.now() - 31 * 60_000) }));
    mocks.db.renderJob.count.mockResolvedValue(1);
    mocks.retrieveFalVideoStatus.mockResolvedValue({ status: "IN_PROGRESS", request_id: "request-1" });
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "failed" });
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "failed", selectedAt: null } });
  });

  it("waits for the initial request ID to be persisted before retiring an abandoned claim", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ providerRequestId: null }));
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "queued" });
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ providerRequestId: null, createdAt: new Date(Date.now() - 3 * 60_000) }));
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "failed" });
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "failed", selectedAt: null } });
  });

  it("does not automatically retry an ambiguously accepted billable submission", async () => {
    await failRenderJob("render-1", "Provider acceptance is unknown.", { providerFailureCode: "FAL_SUBMISSION_UNKNOWN" });
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "failed", selectedAt: null } });
  });

  it("does not buy a replacement generation when a completed video's storage keeps failing", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ providerOutputUri: "https://v3.fal.media/output.mp4", createdAt: new Date(Date.now() - 31 * 60_000) }));
    mocks.persistVideoAsset.mockRejectedValueOnce(new Error("Storage unavailable"));
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "failed" });
    expect(mocks.tx.promptSubmission.update).toHaveBeenCalledWith({ where: { id: "submission-1" }, data: { status: "failed", selectedAt: null } });
  });

  it("does not revive a terminal render after a racing completion", async () => {
    mocks.db.renderJob.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileRenderJob("render-1")).toMatchObject({ status: "in_progress" });
    expect(mocks.persistVideoAsset).not.toHaveBeenCalled();
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ status: "completed" }));
    expect(await failRenderJob("render-1", "Late failure")).toMatchObject({ failed: false, changed: false });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("identifies native completion failures without logging secrets or repeating every poll", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ id: "render-native-diagnostic" }));
    mocks.readVideoMetadata.mockRejectedValue(new Error("Could not load the node-av native binding for linux-x64. private-prompt secret:key"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await reconcileRenderJob("render-native-diagnostic")).toMatchObject({ status: "in_progress" });
      expect(await reconcileRenderJob("render-native-diagnostic")).toMatchObject({ status: "in_progress" });
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledWith("[render-job] completion step will retry", {
        sessionId: "session-1", renderJobId: "render-native-diagnostic", providerRequestId: "request-1", assetId: "asset-1",
        phase: "read_video_metadata", errorClass: "Error", errorCode: "NATIVE_BINDING_UNAVAILABLE", httpStatus: null, retrying: true
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-prompt");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("secret:key");
      expect(mocks.persistVideoAsset).not.toHaveBeenCalled();
      expect(mocks.startFalVideoRender).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it("logs terminal provider result failures with phase, status, and bounded code", async () => {
    mocks.db.renderJob.findUnique.mockResolvedValue(job({ id: "render-result-diagnostic" }));
    mocks.retrieveFalVideoResult.mockRejectedValueOnce(new FalApiError("sensitive provider payload", { status: 404, code: "request_not_found" }));
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await reconcileRenderJob("render-result-diagnostic")).toMatchObject({ status: "failed" });
      expect(failure).toHaveBeenCalledWith("[render-job] completion step failed", expect.objectContaining({
        renderJobId: "render-result-diagnostic", phase: "provider_result", errorClass: "FalApiError", errorCode: "request_not_found", httpStatus: 404, retrying: false
      }));
      expect(JSON.stringify(failure.mock.calls)).not.toContain("sensitive provider payload");
    } finally { failure.mockRestore(); }
  });
});
