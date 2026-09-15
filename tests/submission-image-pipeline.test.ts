import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    moderationResult: {
      create: vi.fn()
    },
    rankingResult: {
      create: vi.fn()
    },
    promptSubmission: {
      create: vi.fn(),
      update: vi.fn()
    }
  };

  return {
    assessSubmission: vi.fn(),
    assessSubmissionImage: vi.fn(),
    checkSubmissionRateLimit: vi.fn(),
    createSubmission: transaction.promptSubmission.create,
    findSession: vi.fn(),
    getParticipantModerationBlockCount: vi.fn(),
    persistSubmissionImage: vi.fn(),
    recordAuditEvent: vi.fn(),
    transaction,
    runTransaction: vi.fn(
      async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)
    )
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findSession
    },
    promptSubmission: {
      create: mocks.createSubmission,
      findUnique: vi.fn()
    },
    $transaction: mocks.runTransaction
  }
}));

vi.mock("@/lib/ai-assessment", () => ({
  assessSubmission: mocks.assessSubmission
}));

vi.mock("@/lib/image-moderation", () => ({
  assessSubmissionImage: mocks.assessSubmissionImage,
  participantImageModerationBlockedReason:
    "The attached image was blocked by venue-safe image moderation."
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSubmissionRateLimit: mocks.checkSubmissionRateLimit
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));

vi.mock("@/lib/storage", () => ({
  persistSubmissionImage: mocks.persistSubmissionImage
}));

vi.mock("@/lib/participant-session", () => ({
  getParticipantBlocksRemaining: (count: number) => Math.max(0, 3 - count),
  getParticipantModerationBlockCount:
    mocks.getParticipantModerationBlockCount,
  getParticipantModerationEventType: (fingerprint: string) =>
    `participant.input_moderation_block.${fingerprint}`,
  isParticipantBanned: (count: number) => count >= 3,
  participantImageModerationEventSummary:
    "Counted a participant image-moderation block",
  participantModerationBanThreshold: 3
}));

vi.mock("@/lib/submission-rate-limit-state", () => ({
  getSubmissionRateLimitSettings: () => ({
    enabled: false,
    count: 3
  }),
  submissionRateLimitConfiguredEvent: "submission.rate_limit_configured"
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: vi.fn()
}));

vi.mock("@/lib/rendering", () => ({
  failRenderJob: vi.fn(),
  formatVideoModerationFailureReason: (message: string) => message,
  getVideoProviderFailureCode: () => null,
  isVideoModerationError: () => false,
  reconcileRenderJob: vi.fn(),
  startVideoRender: vi.fn()
}));

vi.mock("@/lib/google-key-store", () => ({
  getEffectiveGeminiApiKeyForUser: vi.fn()
}));

import { ingestSubmission } from "@/lib/submission-pipeline";

describe("image moderation in the submission pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      status: "live",
      artistControlEnabled: true,
      auditEvents: [],
      submissions: []
    });
    mocks.checkSubmissionRateLimit.mockResolvedValue({
      allowed: true
    });
    mocks.assessSubmission.mockResolvedValue({
      decision: "approved",
      score: 90,
      flags: [],
      explanation: "Prompt is safe.",
      approvalReason: "Prompt approved.",
      noveltyScore: 90,
      cohesionScore: 90,
      remixDeltaScore: 90,
      winningPrompt: "Approved render prompt"
    });
    mocks.assessSubmissionImage.mockResolvedValue({
      decision: "rejected",
      flags: ["sexual"],
      explanation:
        "The attached image was blocked by venue-safe image moderation. Categories: sexual."
    });
    mocks.createSubmission.mockResolvedValue({
      id: "submission-1"
    });
    mocks.getParticipantModerationBlockCount
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
  });

  it("discards a blocked image and locks the device on its third image strike", async () => {
    const result = await ingestSubmission({
      sessionCode: "LIVE01",
      source: "web",
      prompt: "Make the next scene look like this photo",
      sender: "nightowl",
      senderFingerprintSeed: "unused-ip",
      participantToken: "participant-token-12345",
      referenceImage: {
        data: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: "image/jpeg"
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "banned",
        submissionId: "submission-1",
        moderationBlockCount: 3,
        blocksRemaining: 0
      })
    );
    expect(mocks.persistSubmissionImage).not.toHaveBeenCalled();
    expect(mocks.createSubmission).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referenceImageUrl: null,
        referenceImageStoragePath: null,
        referenceImageMimeType: null
      })
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringMatching(
          /^participant\.input_moderation_block\./
        ),
        summary: "Counted a participant image-moderation block"
      })
    );
  });
});
