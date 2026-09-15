import { beforeEach, describe, expect, it, vi } from "vitest";
import { participantImageModerationBlockedReason } from "@/lib/image-moderation";
import { videoModerationBlockedReason } from "@/lib/video-moderation";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findSubmission: vi.fn(),
  findRenderJobs: vi.fn(),
  countAuditEvents: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findSession
    },
    promptSubmission: {
      findUnique: mocks.findSubmission
    },
    renderJob: {
      findMany: mocks.findRenderJobs
    },
    auditEvent: {
      count: mocks.countAuditEvents
    }
  }
}));

import { getPublicSubmissionStatus } from "@/lib/public-submission-status";

describe("public provider-moderation status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      code: "LIVE01"
    });
    mocks.findSubmission.mockResolvedValue({
      id: "submission-1",
      sessionId: "session-1",
      senderFingerprint: "device-hash",
      rawText: "Carry this image into the next scene",
      normalizedText: "Carry this image into the next scene",
      referenceImageUrl: "https://example.com/reference.jpg",
      status: "rejected",
      approvalReason: videoModerationBlockedReason,
      createdAt: new Date("2026-08-26T12:00:00.000Z"),
      updatedAt: new Date("2026-08-26T12:01:00.000Z"),
      rankingResult: null,
      moderationResult: {
        decision: "approved",
        explanation: "The image passed intake moderation."
      }
    });
    mocks.findRenderJobs.mockResolvedValue([
      {
        id: "render-1",
        status: "failed",
        failureReason: videoModerationBlockedReason,
        providerFailureCode: "SAFETY.INPUT.IMAGE",
        outputAsset: {
          status: "failed"
        }
      }
    ]);
  });

  it("explains a provider-side image diagnostic without issuing a strike", async () => {
    const status = await getPublicSubmissionStatus("LIVE01", "submission-1");

    expect(status).toEqual(
      expect.objectContaining({
        state: "provider-blocked",
        title: "Video provider could not render this remix",
        detail: expect.stringContaining("attached image")
      })
    );
    expect(status?.detail).toContain("did not count against your device");
    expect(status).not.toHaveProperty("moderationBlockCount");
    expect(status).not.toHaveProperty("blocksRemaining");
    expect(mocks.countAuditEvents).not.toHaveBeenCalled();
  });

  it("keeps independently rejected images on the participant strike path", async () => {
    mocks.findSubmission.mockResolvedValue({
      ...(await mocks.findSubmission()),
      approvalReason: `${participantImageModerationBlockedReason} Categories: sexual.`
    });
    mocks.findRenderJobs.mockResolvedValue([]);
    mocks.countAuditEvents.mockResolvedValue(2);

    const status = await getPublicSubmissionStatus("LIVE01", "submission-1");

    expect(status).toEqual(
      expect.objectContaining({
        state: "blocked",
        moderationBlockCount: 2,
        blocksRemaining: 1
      })
    );
    expect(mocks.countAuditEvents).toHaveBeenCalledOnce();
  });

  it("reports exhausted video generation as a terminal failure", async () => {
    mocks.findSubmission.mockResolvedValue({
      ...(await mocks.findSubmission()),
      status: "failed",
      approvalReason: "Approved for the story queue."
    });
    mocks.findRenderJobs.mockResolvedValue([{ status: "failed", failureReason: "PRIVATE_PROVIDER_DIAGNOSTIC" }]);

    const status = await getPublicSubmissionStatus("LIVE01", "submission-1");

    expect(status?.state).toBe("failed");
    expect(status?.detail).toContain("automatic retries have stopped");
    expect(status?.detail).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
  });

  it("explains uncertain provider acceptance without promising another render attempt", async () => {
    mocks.findSubmission.mockResolvedValue({
      ...(await mocks.findSubmission()),
      status: "failed",
      approvalReason: "Approved for the story queue."
    });
    mocks.findRenderJobs.mockResolvedValue([{ status: "failed", providerFailureCode: "FAL_SUBMISSION_UNKNOWN" }]);

    const status = await getPublicSubmissionStatus("LIVE01", "submission-1");

    expect(status?.state).toBe("failed");
    expect(status?.detail).toContain("did not confirm this request");
    expect(status?.detail).toContain("avoid duplicate videos");
  });

  it("keeps a failed attempt retrying when its submission is still approved", async () => {
    mocks.findSubmission.mockResolvedValue({
      ...(await mocks.findSubmission()),
      status: "approved",
      approvalReason: "Approved for the story queue."
    });
    mocks.findRenderJobs.mockResolvedValue([{ status: "failed", failureReason: "Temporary provider outage" }]);

    expect((await getPublicSubmissionStatus("LIVE01", "submission-1"))?.state).toBe("retrying");
  });
});
