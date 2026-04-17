import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseSessionToken } from "@/lib/auth-core";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token);

  if (!payload) {
    return null;
  }

  return db.user.findUnique({
    where: {
      id: payload.userId
    }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export function getLoginCookie(token: string) {
  return {
    name: env.sessionCookieName,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  };
}

export { createSessionToken, hashPassword, verifyPassword } from "@/lib/auth-core";

export function getLogoutCookie() {
  return {
    name: env.sessionCookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
}
