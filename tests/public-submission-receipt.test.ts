import { describe, expect, it } from "vitest";
import { getPublicSubmissionReceipt } from "@/components/public-submission-form";

const prompt = "The fox opens a door to an underwater city.";

describe("public submission receipts", () => {
  it.each([true, false])("never shows a rate-limited idea as received even with responseOk=%s", (responseOk) => {
    const receipt = getPublicSubmissionReceipt(responseOk, {
      status: "rate-limited",
      message: "Please wait before sending another idea."
    }, prompt);

    expect(receipt).toEqual({
      received: false,
      message: "Please wait before sending another idea.",
      trackedStatus: null
    });
  });

  it.each([null, {}, { status: "approved" }, { status: "approved", submissionId: " " }, { status: "unknown", submissionId: "idea-1" }])(
    "requires a saved receipt before confirming intake: %j",
    (payload) => {
      expect(getPublicSubmissionReceipt(true, payload, prompt)).toMatchObject({
        received: false,
        message: expect.stringContaining("did not confirm receipt"),
        trackedStatus: null
      });
    }
  );

  it("tracks a confirmed approved submission", () => {
    expect(getPublicSubmissionReceipt(true, {
      status: "approved", submissionId: "idea-1", message: "Your idea is in the story queue."
    }, prompt)).toMatchObject({
      received: true,
      submissionId: "idea-1",
      trackedStatus: { state: "approved", prompt, title: "Received by the queue" }
    });
  });

  it("shows a saved rejection as rejected", () => {
    expect(getPublicSubmissionReceipt(true, {
      status: "rejected", submissionId: "idea-1", message: "This idea is no longer queued."
    }, prompt)).toMatchObject({
      received: true,
      submissionId: "idea-1",
      trackedStatus: { state: "rejected", prompt }
    });
  });

});
