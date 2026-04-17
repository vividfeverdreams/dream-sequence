import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { env } from "@/lib/env";

const demoLoopUrl = process.env.DEMO_LOOP_URL ?? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const storageRoot = path.join(process.cwd(), "storage", "videos");

export async function ensureStorageRoot() {
  await mkdir(storageRoot, {
    recursive: true
  });
}

export async function persistVideoAsset(assetId: string, data: Buffer) {
  await ensureStorageRoot();
  const fileName = `${assetId}.mp4`;
  const absolutePath = path.join(storageRoot, fileName);

  await writeFile(absolutePath, data);

  return {
    storagePath: absolutePath,
    publicUrl: `${env.appUrl}/api/assets/${assetId}`
  };
}

export function getStoredVideoPath(assetId: string) {
  return path.join(storageRoot, `${assetId}.mp4`);
}

export function getDemoLoopUrl() {
  return demoLoopUrl;
}
