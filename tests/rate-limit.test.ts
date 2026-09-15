import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countSubmissions: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    promptSubmission: {
      count: mocks.countSubmissions
    }
  }
}));

import { checkSubmissionRateLimit } from "@/lib/rate-limit";

describe("submission rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows submissions without querying history when the session limit is off", async () => {
    await expect(checkSubmissionRateLimit("session-1", "device-1", null)).resolves.toEqual({
      allowed: true
    });
    expect(mocks.countSubmissions).not.toHaveBeenCalled();
  });

  it("uses the session's configured submission count", async () => {
    mocks.countSubmissions.mockResolvedValue(5);

    await expect(checkSubmissionRateLimit("session-1", "device-1", 5)).resolves.toEqual({
      allowed: false,
      reason: "You have already sent 5 ideas in the last ten minutes."
    });
    expect(mocks.countSubmissions).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        senderFingerprint: "device-1",
        createdAt: {
          gte: expect.any(Date)
        }
      }
    });
  });
});
