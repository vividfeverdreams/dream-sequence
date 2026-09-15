import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "This video webhook is retired. H3 Max jobs are reconciled through the fal.ai queue."
    },
    {
      status: 410
    }
  );
}
