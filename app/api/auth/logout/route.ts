import { NextResponse } from "next/server";
import { getLogoutCookie } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({
    ok: true
  });

  response.cookies.set(getLogoutCookie());
  return response;
}
