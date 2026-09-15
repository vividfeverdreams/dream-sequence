import { Buffer } from "node:buffer";
import { extractVideoClosingFrameJpeg } from "@/lib/video-closing-frame";
import {
  defaultVideoModelId,
  defaultVideoResolution,
  getVideoModelDefinition,
  isVideoModelDurationSupported,
  isVideoModelId,
  isVideoResolution
} from "@/lib/video-models";

export const falVideoEndpoint = "minimax/h3-max/image-to-video";
const queueBaseUrl = `https://queue.fal.run/${falVideoEndpoint}`;
// fal's official client strips the endpoint subpath for queue operations.
const queueRequestBaseUrl = "https://queue.fal.run/minimax/h3-max";
const requestTimeoutMs = 45_000;
const mediaTimeoutMs = 60_000;
const maximumVideoBytes = 250 * 1024 * 1024;

export type FalRenderStrategy = "fal_text_to_video" | "fal_image_to_video";
export type FalQueueStatus = {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  request_id: string;
  error?: string;
  error_type?: string;
  queue_position?: number;
};

export class FalApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, input: { status?: number; code?: string | null } = {}) {
    super(message);
    this.name = "FalApiError";
    this.status = input.status ?? 0;
    this.code = input.code ?? null;
  }
}

export function isFalModerationError(error: unknown) {
  return error instanceof FalApiError &&
    /content_policy|safety|moderation|nsfw/i.test(error.code ?? "");
}

// Only polling and downloads are retried. Repeating a POST after an ambiguous
// network failure could submit a second billable generation.
export function isRetryableFalError(error: unknown) {
  if (isFalModerationError(error)) return false;
  if (error instanceof FalApiError) {
    return error.status === 0 || error.status === 408 || error.status === 425 ||
      error.status === 429 || error.status >= 500;
  }
  return error instanceof Error;
}

export async function startFalVideoRender(input: {
  mode: "seed" | "remix";
  prompt: string;
  sourceVideoUrl?: string | null;
  apiKey: string;
  durationSeconds?: number | null;
  resolution?: string | null;
  model?: string | null;
}) {
  const model = input.model ?? defaultVideoModelId;
  const duration = input.durationSeconds ?? getVideoModelDefinition(defaultVideoModelId).defaultDurationSeconds;
  const resolution = input.resolution ?? defaultVideoResolution;

  if (!input.apiKey.trim()) throw new FalApiError("H3 Max requires FAL_KEY on the server.", { status: 401 });
  if (!isVideoModelId(model)) throw new FalApiError("H3 Max is the only supported video model.", { status: 400 });
  if (!isVideoModelDurationSupported(model, duration)) throw new FalApiError("H3 Max clips must be 5–15 whole seconds.", { status: 400 });
  if (!isVideoResolution(resolution)) throw new FalApiError("Choose 480P, 768P, or 1080P for H3 Max.", { status: 400 });
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 50_000) throw new FalApiError("H3 Max requires a prompt between 1 and 50,000 characters.", { status: 400 });

  let openingFrame: string | undefined;
  if (input.mode === "remix") {
    if (!input.sourceVideoUrl) throw new FalApiError("Story continuation requires the previous completed clip.", { status: 400 });
    // The actual previous clip is authoritative. Never trust a generic thumbnail
    // and never submit a text-only continuation if decoding fails.
    const video = await downloadFalVideo(input.sourceVideoUrl);
    const closingFrame = await extractVideoClosingFrameJpeg(video);
    if (!closingFrame.length) throw new Error("The previous clip's final frame could not be extracted.");
    openingFrame = `data:image/jpeg;base64,${closingFrame.toString("base64")}`;
  }

  let started: { request_id?: string };
  try {
    started = await falRequest<{ request_id?: string }>(queueBaseUrl, input.apiKey, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      duration,
      resolution,
      prompt_expansion_mode: "balanced",
      enable_safety_checker: true,
      ...(openingFrame ? { image_url: openingFrame } : {})
    })
    });
  } catch (error) {
    // Explicit validation/auth/rate-limit responses confirm rejection. Network
    // failures and server errors do not prove that the billable job was rejected.
    if (error instanceof FalApiError && error.status >= 400 && error.status < 500 && error.status !== 408) throw error;
    throw new FalApiError("fal.ai did not confirm whether this clip was accepted. Check your fal.ai queue before retrying.", { code: "FAL_SUBMISSION_UNKNOWN" });
  }
  if (!started.request_id || !/^[\w-]+$/.test(started.request_id)) {
    throw new FalApiError("fal.ai did not return a valid generation request ID. Check your fal.ai queue before retrying.", { code: "FAL_SUBMISSION_UNKNOWN" });
  }
  return {
    requestId: started.request_id,
    strategy: (openingFrame ? "fal_image_to_video" : "fal_text_to_video") as FalRenderStrategy
  };
}

export async function retrieveFalVideoStatus(requestId: string, apiKey: string) {
  const status = await falRequest<FalQueueStatus>(`${requestUrl(requestId)}/status`, apiKey);
  if (!["IN_QUEUE", "IN_PROGRESS", "COMPLETED"].includes(status.status)) {
    throw new FalApiError("fal.ai returned an unrecognized generation status.");
  }
  if (status.error || status.error_type) {
    throw new FalApiError("H3 Max could not complete this clip.", {
      status: 422,
      code: status.error_type ?? "generation_failed"
    });
  }
  return status;
}

export async function retrieveFalVideoResult(requestId: string, apiKey: string) {
  const result = await falRequest<{ video?: { url?: string } }>(requestUrl(requestId), apiKey);
  const url = result.video?.url;
  if (!url) throw new FalApiError("H3 Max completed without returning a video.", { status: 422 });
  requireHttpsUrl(url);
  return url;
}

function requestUrl(requestId: string) {
  if (!/^[\w-]+$/.test(requestId)) throw new FalApiError("Invalid fal.ai request ID.", { status: 400 });
  return `${queueRequestBaseUrl}/requests/${encodeURIComponent(requestId)}`;
}

function requireHttpsUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new FalApiError("The video URL is invalid.", { status: 400 }); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new FalApiError("Video files must use a secure HTTPS URL.", { status: 400 });
  }
}

export async function downloadFalVideo(url: string) {
  requireHttpsUrl(url);
  // Media hosts never receive the provider API key.
  const response = await fetch(url, { signal: AbortSignal.timeout(mediaTimeoutMs), cache: "no-store" });
  if (!response.ok) throw new FalApiError(`Video download failed (${response.status}).`, { status: response.status });
  if (Number(response.headers.get("content-length")) > maximumVideoBytes) throw new FalApiError("The generated video is too large.", { status: 413 });
  if (!response.body) throw new FalApiError("The downloaded video was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumVideoBytes) {
        await reader.cancel();
        throw new FalApiError("The generated video is too large.", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new FalApiError("The downloaded video was empty.");
  return Buffer.concat(chunks, size);
}

async function falRequest<T>(url: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(requestTimeoutMs),
    redirect: "error",
    cache: "no-store"
  });
  if (!response.ok) {
    // Provider validation payloads can echo prompts/images; retain only a bounded
    // machine-readable error code and never log the raw response or credentials.
    const body = await response.json().catch(() => null) as {
      error_type?: unknown; detail?: Array<{ type?: unknown }>;
    } | null;
    const rawCode = body?.error_type ?? (Array.isArray(body?.detail) ? body.detail[0]?.type : undefined);
    const code = typeof rawCode === "string" ? rawCode.slice(0, 128) : null;
    throw new FalApiError(`fal.ai video request failed (${response.status}).`, { status: response.status, code });
  }
  return response.json() as Promise<T>;
}
