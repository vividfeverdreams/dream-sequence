import { randomUUID } from "node:crypto";
import type { ValidatedSubmissionImage } from "@/lib/submission-image";
import { extractVideoClosingFrameJpeg } from "@/lib/video-closing-frame";

const demoLoopUrl = process.env.DEMO_LOOP_URL ?? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "renders";

export function isStorageConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export async function persistVideoAsset(assetId: string, data: Buffer) {
  if (!isStorageConfigured()) {
    throw new Error(
      "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const objectPath = `${assetId}.mp4`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "video/mp4",
      "x-upsert": "true"
    },
    body: new Uint8Array(data)
  });

  if (!response.ok) {
    throw new Error(`Supabase storage upload failed (${response.status}): ${await response.text()}`);
  }

  let thumbnailUrl: string | null = null;

  try {
    const closingFrame = await extractVideoClosingFrameJpeg(data);
    const closingFrameObjectPath = `closing-frames/${assetId}.jpg`;
    const closingFrameResponse = await fetch(
      `${supabaseUrl}/storage/v1/object/${bucket}/${closingFrameObjectPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": "image/jpeg",
          "x-upsert": "true"
        },
        body: new Uint8Array(closingFrame)
      }
    );

    if (!closingFrameResponse.ok) {
      throw new Error(
        `Supabase closing-frame upload failed (${closingFrameResponse.status}): ${await closingFrameResponse.text()}`
      );
    }

    thumbnailUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${closingFrameObjectPath}`;
  } catch (error) {
    // Keep the valid clip if its optional cached still cannot be saved. The next
    // continuation re-extracts the final frame from this stored MP4 and will
    // fail explicitly if that frame cannot be decoded.
    console.warn("[video-continuity] closing frame could not be persisted", {
      assetId,
      reason: error instanceof Error ? error.message : "unknown_error"
    });
  }

  return {
    storagePath: `${bucket}/${objectPath}`,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`,
    thumbnailUrl
  };
}

export async function persistSubmissionImage(
  sessionId: string,
  image: ValidatedSubmissionImage
) {
  if (!isStorageConfigured()) {
    throw new Error(
      "Supabase storage is not configured for approved reference images."
    );
  }

  const extension = getSubmissionImageExtension(image.mimeType);
  const objectPath = `submission-images/${sessionId}/${randomUUID()}.${extension}`;
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": image.mimeType
      },
      body: new Uint8Array(image.data)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Supabase reference-image upload failed (${response.status}): ${await response.text()}`
    );
  }

  return {
    storagePath: `${bucket}/${objectPath}`,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
  };
}

export function getDemoLoopUrl() {
  return demoLoopUrl;
}

function getSubmissionImageExtension(
  mimeType: ValidatedSubmissionImage["mimeType"]
) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}
