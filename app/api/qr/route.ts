import { NextResponse } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const data = searchParams.get("data")?.trim() ?? "";

  if (!data || data.length > 500) {
    return NextResponse.json(
      {
        error: "QR code data is required."
      },
      {
        status: 400
      }
    );
  }

  const svg = await QRCode.toString(data, {
    type: "svg",
    margin: 2,
    width: 320,
    color: {
      dark: "#111315",
      light: "#ffffff"
    }
  });

  return new NextResponse(svg, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/svg+xml; charset=utf-8"
    }
  });
}
