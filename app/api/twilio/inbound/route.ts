import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestSubmission } from "@/lib/submission-pipeline";
import { emptyTwiMl, successTwiMl, validateTwilioSignature } from "@/lib/twilio";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const params = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
  );

  const isValid = validateTwilioSignature(
    request.url,
    request.headers.get("x-twilio-signature"),
    params
  );

  if (!isValid) {
    return new NextResponse(emptyTwiMl(), {
      status: 403,
      headers: {
        "Content-Type": "text/xml"
      }
    });
  }

  const toNumber = params.To ?? "";
  const body = params.Body ?? "";
  const from = params.From ?? "";
  const messageSid = params.MessageSid ?? undefined;

  const session =
    (await db.dJSession.findFirst({
      where: {
        smsNumber: toNumber,
        status: "live"
      }
    })) ??
    (await db.dJSession.findFirst({
      where: {
        status: "live"
      },
      orderBy: {
        startedAt: "desc"
      }
    }));

  if (!session) {
    return new NextResponse(successTwiMl("The show is not live yet. Try again once the DJ opens the crowd queue."), {
      headers: {
        "Content-Type": "text/xml"
      }
    });
  }

  try {
    const result = await ingestSubmission({
      sessionCode: session.code,
      source: "sms",
      prompt: body,
      sender: from,
      senderFingerprintSeed: from,
      messageSid
    });

    return new NextResponse(successTwiMl(result.message), {
      headers: {
        "Content-Type": "text/xml"
      }
    });
  } catch (error) {
    return new NextResponse(
      successTwiMl(error instanceof Error ? error.message : "The remix queue could not process that text."),
      {
        headers: {
          "Content-Type": "text/xml"
        }
      }
    );
  }
}
