import { NextResponse } from "next/server";
import { db } from "@/lib/db";

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

  if (!asset || !asset.publicUrl) {
    return NextResponse.json(
      {
        error: "Asset not found."
      },
      {
        status: 404
      }
    );
  }

  return NextResponse.redirect(asset.publicUrl);
}
