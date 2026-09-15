import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { connectTwitchAccount } from "@/lib/twitch";
import { getTwitchConfig, twitchStateCookie, validateTwitchOAuthState } from "@/lib/twitch-security";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const state = user ? validateTwitchOAuthState(
    request.nextUrl.searchParams.get("state"), request.cookies.get(twitchStateCookie)?.value, user.id
  ) : null;
  const destination = new URL(state?.returnTo ?? "/dashboard/new", getTwitchConfig().appUrl);
  let error: string | undefined;
  if (!user || !state) {
    error = "This Twitch connection attempt expired. Sign in and try connecting again.";
  } else if (request.nextUrl.searchParams.has("error")) {
    error = "Twitch connection was cancelled. Connect again when you are ready.";
  } else {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) error = "Twitch did not return an authorization code. Please connect again.";
    else {
      try {
        await connectTwitchAccount(user.id, code);
      } catch {
        // OAuth responses, tokens, database errors, and provider bodies are never
        // reflected into the browser URL or server logs.
        error = "Twitch could not connect. Check the app settings and try again.";
      }
    }
  }
  destination.searchParams.set("twitch", error ? "error" : "connected");
  if (error) destination.searchParams.set("twitchError", error);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(twitchStateCookie, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/twitch", maxAge: 0 });
  return response;
}
