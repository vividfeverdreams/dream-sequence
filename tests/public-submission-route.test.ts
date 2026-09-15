import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ ingestSubmission: vi.fn(), getPublicSubmissionStatus: vi.fn(), after: vi.fn(), attemptAutomatedSelection: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after
}));
vi.mock("@/lib/submission-pipeline", () => ({ ingestSubmission: mocks.ingestSubmission, attemptAutomatedSelection: mocks.attemptAutomatedSelection }));
vi.mock("@/lib/public-submission-status", () => ({ getPublicSubmissionStatus: mocks.getPublicSubmissionStatus }));
import { GET, POST } from "@/app/api/r/[sessionCode]/route";
const input = { prompt: "The fox opens a door to an underwater city.", senderLabel: "Neon Shark", participantToken: "participant-token-12345" };
const context = { params: Promise.resolve({ sessionCode: "LIVE01" }) };
function submit(body: unknown, cookie?: string) {
  return POST(new NextRequest("http://localhost/api/r/LIVE01", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? {cookie} : {}) }, body: JSON.stringify(body) }), context);
}
describe("What happens next intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ingestSubmission.mockResolvedValue({ status: "approved", message: "Your idea is in the story queue.", submissionId: "idea-1" });
  });
  it("passes the viewer's original story continuation into moderation", async () => {
    const response = await submit(input);
    expect(response.status).toBe(200);
    expect(mocks.ingestSubmission).toHaveBeenCalledWith(expect.objectContaining({ sessionCode: "LIVE01", source: "web", prompt: input.prompt, sender: "Neon Shark", participantToken: input.participantToken }), expect.objectContaining({ scheduleSelection: expect.any(Function) }));
    expect(await response.json()).toMatchObject({ submissionId: "idea-1", prompt: input.prompt });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("keeps an existing participant cookie so changing client tokens does not bypass limits", async () => {
    await submit(input, "dream_sequence_participant=existing-participant-12345");
    expect(mocks.ingestSubmission).toHaveBeenCalledWith(expect.objectContaining({participantToken: "existing-participant-12345"}), expect.any(Object));
  });
  it("uses Guest when a nickname is omitted", async () => {
    await submit({ prompt: input.prompt, participantToken: input.participantToken });
    expect(mocks.ingestSubmission).toHaveBeenCalledWith(expect.objectContaining({sender: "Guest"}), expect.any(Object));
  });
  it("reports rate limits as an unsuccessful request without a saved receipt", async () => {
    mocks.ingestSubmission.mockResolvedValue({ status: "rate-limited", message: "Please wait before sending another idea." });
    const response = await submit(input);
    expect(response.status).toBe(429);
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ status: "rate-limited", message: "Please wait before sending another idea.", prompt: input.prompt });
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("returns the saved receipt before starting video preparation", async () => {
    mocks.ingestSubmission.mockImplementation(async (_input, options) => {
      options.scheduleSelection("session-1");
      return { status: "approved", message: "Your idea is in the story queue.", submissionId: "idea-1" };
    });
    const response = await submit(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ submissionId: "idea-1" });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.attemptAutomatedSelection).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.attemptAutomatedSelection).toHaveBeenCalledWith("session-1");
  });
  it("keeps the saved receipt valid if background video preparation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.ingestSubmission.mockImplementation(async (_input, options) => {
      options.scheduleSelection("session-1");
      return { status: "approved", submissionId: "idea-1" };
    });
    mocks.attemptAutomatedSelection.mockRejectedValue(new Error("Provider unavailable"));
    try {
      const response = await submit(input);
      expect(response.status).toBe(200);
      await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith("[submission] automatic selection deferred", { sessionId: "session-1" });
    } finally {
      errorSpy.mockRestore();
    }
  });
  it.each(["", "next", "x".repeat(1201)])("rejects an invalid story prompt", async (prompt) => {
    expect((await submit({...input, prompt})).status).toBe(400);
    expect(mocks.ingestSubmission).not.toHaveBeenCalled();
  });
  it("reports Twitch-only or stopped sessions without claiming submission success", async () => {
    mocks.ingestSubmission.mockRejectedValue(new Error("This story takes ideas from Twitch chat."));
    const response = await submit(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This story takes ideas from Twitch chat." });
  });
  it("polls only the requested session's submission status", async () => {
    mocks.getPublicSubmissionStatus.mockResolvedValue({ status: "ready" });
    const response = await GET(new Request("http://localhost/api/r/LIVE01?submissionId=idea-1"), context);
    expect(mocks.getPublicSubmissionStatus).toHaveBeenCalledWith("LIVE01", "idea-1");
    expect(await response.json()).toMatchObject({ status: "ready" });
  });
});
