import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reconcileRenderJob } from "@/lib/rendering";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        type?: string;
        data?: {
          id?: string;
        };
      }
    | null;

  const videoId = body?.data?.id;

  if (!videoId) {
    return NextResponse.json(
      {
        error: "Missing video id."
      },
      {
        status: 400
      }
    );
  }

  const renderJob = await db.renderJob.findUnique({
    where: {
      openaiVideoId: videoId
    }
  });

  if (!renderJob) {
    return NextResponse.json({
      ok: true
    });
  }

  if (body?.type === "video.failed") {
    await db.renderJob.update({
      where: {
        id: renderJob.id
      },
      data: {
        status: "failed",
        failureReason: "OpenAI webhook reported a failed render."
      }
    });

    return NextResponse.json({
      ok: true
    });
  }

  await reconcileRenderJob(renderJob.id);

  return NextResponse.json({
    ok: true
  });
}
