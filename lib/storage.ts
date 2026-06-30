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

  return {
    storagePath: `${bucket}/${objectPath}`,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
  };
}

export function getDemoLoopUrl() {
  return demoLoopUrl;
}
