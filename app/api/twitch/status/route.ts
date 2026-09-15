import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTwitchConnectionStatus } from "@/lib/twitch";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to connect Twitch." }, { status: 401 });
  try {
    return NextResponse.json(await getTwitchConnectionStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Twitch connection status is temporarily unavailable." }, { status: 503 });
  }
}
