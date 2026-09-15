import { after, NextRequest, NextResponse } from "next/server";
import { attemptAutomatedSelection, ingestSubmission } from "@/lib/submission-pipeline";
import { getPublicSubmissionStatus } from "@/lib/public-submission-status";
import { publicSubmissionSchema } from "@/lib/schemas";
import { getClientIp } from "@/lib/request";

export const maxDuration = 300;

type PublicApiRouteProps = {
  params: Promise<{
    sessionCode: string;
  }>;
};

const participantDeviceCookieName = "dream_sequence_participant";

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

export async function POST(request: NextRequest, { params }: PublicApiRouteProps) {
  const body = await request.json().catch(() => null);
  const parsed = publicSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Tell us what happens next." }, { status: 400 });
  }

  const { sessionCode } = await params;
  const savedParticipantToken =
    request.cookies.get(participantDeviceCookieName)?.value.trim() ?? "";
  const participantToken =
    savedParticipantToken.length >= 16
      ? savedParticipantToken
      : parsed.data.participantToken;

  try {
    const result = await ingestSubmission(
      {
        sessionCode,
        source: "web",
        prompt: parsed.data.prompt,
        sender: parsed.data.senderLabel,
        participantToken,
        senderFingerprintSeed: getClientIp(request)
      },
      {
        scheduleSelection: (sessionId) => {
          after(async () => {
            try {
              await attemptAutomatedSelection(sessionId);
            } catch {
              console.error("[submission] automatic selection deferred", { sessionId });
            }
          });
        }
      }
    );

    const response = NextResponse.json(
      {
        ...result,
        prompt: parsed.data.prompt
      },
      {
        status: result.status === "banned" ? 403 : result.status === "rate-limited" ? 429 : 200
      }
    );

    if (savedParticipantToken.length < 16) {
      response.cookies.set(participantDeviceCookieName, participantToken, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      });
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not submit your story idea."
      },
      {
        status: 400
      }
    );
  }
}
