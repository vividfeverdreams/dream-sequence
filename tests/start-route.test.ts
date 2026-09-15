import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  startDjSession: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser
}));

vi.mock("@/lib/session-service", () => ({
  initialGenerationQueueFailureMessage:
    "The first video could not be queued. Retry the generation.",
  initialGenerationRecoveryFailureMessage: "The existing clip could not be recovered. No new generation was requested. Try recovering it again.",
  startDjSession: mocks.startDjSession
}));

import { POST } from "@/app/api/sessions/[sessionId]/start/route";

describe("session start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1"
    });
  });

  it("returns the initial-generation queue error to the dashboard", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.startDjSession.mockRejectedValue(
      new Error("The first video could not be queued. Retry the generation.")
    );

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/start", {
        method: "POST"
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The first video could not be queued. Retry the generation."
    });
    expect(errorSpy).toHaveBeenCalledWith("[session-start] failed", {
      sessionId: "session-1",
      failureReason: "The first video could not be queued. Retry the generation."
    });

    errorSpy.mockRestore();
  });

  it("returns the live session when its first video was queued", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.startDjSession.mockResolvedValue({
      id: "session-1",
      status: "live"
    });

    const response = await POST(
      new Request("https://example.com/api/sessions/session-1/start", {
        method: "POST"
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "session-1",
      status: "live"
    });

    infoSpy.mockRestore();
  });
});
