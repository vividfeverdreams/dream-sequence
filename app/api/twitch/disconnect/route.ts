import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { disconnectTwitchAccount } from "@/lib/twitch";
import { getTwitchConfig } from "@/lib/twitch-security";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to disconnect Twitch." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(getTwitchConfig().appUrl).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  return NextResponse.json(await disconnectTwitchAccount(user.id), { headers: { "Cache-Control": "no-store" } });
}
