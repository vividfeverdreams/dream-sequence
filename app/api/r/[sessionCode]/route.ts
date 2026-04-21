import { NextResponse } from "next/server";
import { ingestSubmission } from "@/lib/submission-pipeline";
import { getPublicSubmissionStatus } from "@/lib/public-submission-status";
import { publicSubmissionSchema } from "@/lib/schemas";
import { getClientIp } from "@/lib/request";

type PublicApiRouteProps = {
  params: Promise<{
    sessionCode: string;
  }>;
};

export async function GET(request: Request, { params }: PublicApiRouteProps) {
  const { sessionCode } = await params;
  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("submissionId")?.trim() ?? "";

  if (!submissionId) {
    return NextResponse.json(
      {
        error: "Submission id is required."
      },
      {
        status: 400
      }
    );
  }

  const status = await getPublicSubmissionStatus(sessionCode, submissionId);

  if (!status) {
    return NextResponse.json(
      {
        error: "Submission not found."
      },
      {
        status: 404
      }
    );
  }

  return NextResponse.json(status);
}

export async function POST(request: Request, { params }: PublicApiRouteProps) {
  const body = await request.json().catch(() => null);
  const parsed = publicSubmissionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Send a slightly more specific remix idea."
      },
      {
        status: 400
      }
    );
  }

  const { sessionCode } = await params;

  try {
    const result = await ingestSubmission({
      sessionCode,
      source: "web",
      prompt: parsed.data.prompt,
      sender: parsed.data.senderLabel,
      senderFingerprintSeed: getClientIp(request)
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not submit the remix."
      },
      {
        status: 400
      }
    );
  }
}
