import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  clearOpenAiApiKeyForUser,
  getOpenAiConnectionStatusForUser,
  saveOpenAiApiKeyForUser
} from "@/lib/openai-key-store";
import { openAiApiKeySchema } from "@/lib/schemas";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  return NextResponse.json({
    openAiStatus: await getOpenAiConnectionStatusForUser(user.id)
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = openAiApiKeySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Enter a valid API key."
      },
      {
        status: 400
      }
    );
  }

  return NextResponse.json({
    openAiStatus: await saveOpenAiApiKeyForUser(user.id, parsed.data.apiKey)
  });
}

export async function DELETE() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  return NextResponse.json({
    openAiStatus: await clearOpenAiApiKeyForUser(user.id)
  });
}
