import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get as getBlob, put as putBlob } from "@vercel/blob";

const demoLoopUrl = process.env.DEMO_LOOP_URL ?? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const storageRoot = path.join(process.cwd(), "storage", "videos");
const blobStorageEnabled =
  process.env.NODE_ENV === "production" && Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function blobStreamToBuffer(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

export async function ensureStorageRoot() {
  await mkdir(storageRoot, {
    recursive: true
  });
}

export async function persistVideoAsset(assetId: string, data: Buffer) {
  if (blobStorageEnabled) {
    const pathname = `videos/${assetId}.mp4`;
    const blob = await putBlob(pathname, data, {
      access: "private",
      allowOverwrite: true,
      contentType: "video/mp4",
      multipart: true
    });

    return {
      storagePath: `blob:${blob.pathname}`,
      publicUrl: `/api/assets/${assetId}`
    };
  }

  await ensureStorageRoot();
  const fileName = `${assetId}.mp4`;
  const absolutePath = path.join(storageRoot, fileName);

  await writeFile(absolutePath, data);

  return {
    storagePath: absolutePath,
    publicUrl: `/api/assets/${assetId}`
  };
}

export function getStoredVideoPath(assetId: string) {
  return path.join(storageRoot, `${assetId}.mp4`);
}

export async function readVideoAsset(assetId: string) {
  if (blobStorageEnabled) {
    const pathname = `videos/${assetId}.mp4`;
    const blob = await getBlob(pathname, {
      access: "private",
      useCache: false
    });

    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      throw new Error(`Stored video asset ${assetId} is not available in Blob storage.`);
    }

    return blobStreamToBuffer(blob.stream);
  }

  return readFile(getStoredVideoPath(assetId));
}

export function getDemoLoopUrl() {
  return demoLoopUrl;
}
