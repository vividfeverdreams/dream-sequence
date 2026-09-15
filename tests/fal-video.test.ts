import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ extractVideoClosingFrameJpeg: vi.fn() }));
vi.mock("@/lib/video-closing-frame", () => mocks);
import {
  FalApiError,
  downloadFalVideo,
  falVideoEndpoint,
  isFalModerationError,
  isRetryableFalError,
  retrieveFalVideoResult,
  retrieveFalVideoStatus,
  startFalVideoRender
} from "@/lib/fal-video";
const apiKey = "test-fal-key";
const base = `https://queue.fal.run/${falVideoEndpoint}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("H3 Max through fal.ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractVideoClosingFrameJpeg.mockResolvedValue(Buffer.from("exact-final-frame"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the first clip from the story prompt with the selected duration and quality", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ request_id: "job-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "seed", prompt: "A doorway opens", apiKey, durationSeconds: 12, resolution: "1080P" })).resolves.toEqual({ requestId: "job-1", strategy: "fal_text_to_video" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(base);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers.Authorization).toBe(`Key ${apiKey}`);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ prompt: "A doorway opens", duration: 12, resolution: "1080P", prompt_expansion_mode: "balanced", enable_safety_checker: true });
    expect(mocks.extractVideoClosingFrameJpeg).not.toHaveBeenCalled();
  });

  it("continues from the last decoded frame of the actual previous MP4", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Buffer.from("previous-clip")))
      .mockResolvedValueOnce(json({ request_id: "job-2" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "remix", prompt: "The traveler walks through", apiKey, sourceVideoUrl: "https://storage.example.com/previous.mp4", resolution: "480P", durationSeconds: 5 })).resolves.toEqual({ requestId: "job-2", strategy: "fal_image_to_video" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://storage.example.com/previous.mp4");
    expect(fetchMock.mock.calls[0]?.[1].headers).toBeUndefined();
    expect(mocks.extractVideoClosingFrameJpeg).toHaveBeenCalledWith(Buffer.from("previous-clip"));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({ image_url: `data:image/jpeg;base64,${Buffer.from("exact-final-frame").toString("base64")}`, duration: 5, resolution: "480P" });
  });

  it("never submits a text-only continuation after decoding fails", async () => {
    mocks.extractVideoClosingFrameJpeg.mockRejectedValueOnce(new Error("Cannot decode final frame"));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(Buffer.from("invalid-mp4")));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "remix", prompt: "Continue", apiKey, sourceVideoUrl: "https://storage.example.com/previous.mp4" })).rejects.toThrow("Cannot decode final frame");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { model: "seedance2" }, { model: "gemini_omni_flash" },
    { durationSeconds: 4 }, { durationSeconds: 16 }, { durationSeconds: 7.5 },
    { resolution: "720P" }, { resolution: "420P" }, { apiKey: "" }, { prompt: " " }
  ])("rejects invalid input before spending on generation: %j", async (invalid) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "seed", prompt: "A story begins", apiKey, ...invalid })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a source clip for every continuation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "remix", prompt: "Continue", apiKey })).rejects.toThrow("previous completed clip");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resubmit a generation after an ambiguous POST network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failure"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(startFalVideoRender({ mode: "seed", prompt: "Begin", apiKey })).rejects.toMatchObject({ code: "FAL_SUBMISSION_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls the persisted request and reads a completed result", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ status: "COMPLETED", request_id: "job-1" })).mockResolvedValueOnce(json({ video: { url: "https://v3.fal.media/clip.mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await retrieveFalVideoStatus("job-1", apiKey)).status).toBe("COMPLETED");
    expect(await retrieveFalVideoResult("job-1", apiKey)).toBe("https://v3.fal.media/clip.mp4");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://queue.fal.run/minimax/h3-max/requests/job-1/status", "https://queue.fal.run/minimax/h3-max/requests/job-1"]);
  });

  it("recognizes moderation from fal's structured failure without exposing its payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ detail: [{ type: "content_policy_violation", input: "private prompt" }] }, 422));
    vi.stubGlobal("fetch", fetchMock);
    const error = await retrieveFalVideoResult("job-1", apiKey).catch((error: unknown) => error);
    expect(isFalModerationError(error)).toBe(true);
    expect(isRetryableFalError(error)).toBe(false);
    expect((error as Error).message).not.toContain("private prompt");
    expect(isRetryableFalError(new FalApiError("temporarily unavailable", { status: 503 }))).toBe(true);
    expect(isRetryableFalError(new FalApiError("invalid key", { status: 401 }))).toBe(false);
  });

  it("rejects failed completed jobs and empty completed results", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ status: "COMPLETED", request_id: "job-1", error: "blocked", error_type: "content_policy_violation" })).mockResolvedValueOnce(json({ video: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(retrieveFalVideoStatus("job-1", apiKey)).rejects.toMatchObject({ code: "content_policy_violation" });
    await expect(retrieveFalVideoResult("job-1", apiKey)).rejects.toThrow("without returning a video");
  });

  it("does not forward credentials to video hosts and rejects unsafe URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("mp4")));
    vi.stubGlobal("fetch", fetchMock);
    expect(await downloadFalVideo("https://v3.fal.media/clip.mp4")).toEqual(Buffer.from("mp4"));
    expect(fetchMock.mock.calls[0]?.[1].headers).toBeUndefined();
    await expect(downloadFalVideo("http://example.com/clip.mp4")).rejects.toThrow("HTTPS");
    await expect(downloadFalVideo("https://key:secret@example.com/clip.mp4")).rejects.toThrow("HTTPS");
  });
});
