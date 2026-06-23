import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
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

  return NextResponse.json({
    code,
    path: `/r/${code}`,
    available: !existingSession
  });
}
