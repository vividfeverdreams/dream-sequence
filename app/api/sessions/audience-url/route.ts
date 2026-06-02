import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { slugifyCode } from "@/lib/utils";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "You need to log in first."
      },
      {
        status: 401
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = slugifyCode(searchParams.get("code") ?? "", 48);

  if (code.length < 3) {
    return NextResponse.json(
      {
        error: "Use at least three letters or numbers for the audience URL."
      },
      {
        status: 400
      }
    );
  }

  const existingSession = await db.dJSession.findUnique({
    where: {
      code
    }
  });
  const path = `/r/${code}`;

  return NextResponse.json({
    code,
    path,
    url: `${getPublicAppOrigin(request)}${path}`,
    available: !existingSession
  });
}

function getPublicAppOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const configuredAppUrl = env.appUrl.trim();

  if (!configuredAppUrl) {
    return requestOrigin;
  }

  try {
    const configuredUrl = new URL(configuredAppUrl);
    const isLocalDefault =
      configuredUrl.hostname === "localhost" || configuredUrl.hostname === "127.0.0.1";

    return isLocalDefault ? requestOrigin : configuredUrl.origin;
  } catch {
    return requestOrigin;
  }
}
