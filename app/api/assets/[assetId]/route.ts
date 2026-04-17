import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readStoredAsset } from "@/lib/rendering";

export const runtime = "nodejs";

type AssetRouteProps = {
  params: Promise<{
    assetId: string;
  }>;
};

export async function GET(_request: Request, { params }: AssetRouteProps) {
  const { assetId } = await params;
  const asset = await db.visualAsset.findUnique({
    where: {
      id: assetId
    }
  });

  if (!asset) {
    return NextResponse.json(
      {
        error: "Asset not found."
      },
      {
        status: 404
      }
    );
  }

  if (!asset.storagePath && asset.publicUrl) {
    return NextResponse.redirect(asset.publicUrl);
  }

  if (!asset.storagePath) {
    return NextResponse.json(
      {
        error: "Video file not available."
      },
      {
        status: 404
      }
    );
  }

  const buffer = await readStoredAsset(asset.id);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
