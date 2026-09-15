import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { twitchAuthorizationUrl } from "@/lib/twitch";
import { createTwitchOAuthState, getTwitchConfig, isTwitchConfigured, safeTwitchReturnPath, twitchStateCookie } from "@/lib/twitch-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", getTwitchConfig().appUrl));
  const returnTo = safeTwitchReturnPath(request.nextUrl.searchParams.get("returnTo"));
  if (!isTwitchConfigured()) {
    const url = new URL(returnTo, getTwitchConfig().appUrl);
    url.searchParams.set("twitch", "error");
    url.searchParams.set("twitchError", "Twitch mode is not configured on this platform yet.");
    return NextResponse.redirect(url);
  }
  const state = createTwitchOAuthState(user.id, returnTo);
  const response = NextResponse.redirect(twitchAuthorizationUrl(state));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(twitchStateCookie, state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/twitch", maxAge: 10 * 60
  });
  return response;
}
