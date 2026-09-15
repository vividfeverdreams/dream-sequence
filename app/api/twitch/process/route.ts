import { NextResponse } from "next/server";
import { drainPendingTwitchEvents, validateTwitchConnections } from "@/lib/twitch";
import { equalTwitchSecret, isTwitchConfigured } from "@/lib/twitch-security";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equalTwitchSecret(request.headers.get("authorization") || "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isTwitchConfigured()) return NextResponse.json({ configured: false, processed: 0 });
  const validation = await validateTwitchConnections();
  return NextResponse.json({ ...await drainPendingTwitchEvents({ limit: 10 }), validation });
}
