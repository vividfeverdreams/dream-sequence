import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResponse: vi.fn(),
  getEffectiveApiKey: vi.fn()
}));

vi.mock("@/lib/openai-client", () => ({
  getOpenAiClient: () => ({ responses: { create: mocks.createResponse } })
}));

vi.mock("@/lib/openai-key-store", () => ({
  getEffectiveOpenAiApiKeyForUser: mocks.getEffectiveApiKey
}));
import {
  assessSubmission,
  heuristicAssessment,
  submissionAssessmentInstructions
} from "@/lib/ai-assessment";

describe("bounded submission assessment", () => {
  const session = {
    userId: "user-1",
    artistName: "Neon Echo",
    trackName: "Skyline Pressure",
    creativeBible: "A continuous dream story.",
    allowedMotifs: "",
    bannedTerms: "",
    colorPalette: "teal, ember",
    motionRules: "steady drift",
    basePrompt: "A fox opens a door.",
    artistControlEnabled: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveApiKey.mockResolvedValue("test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to safe local assessment when the provider times out, without SDK retries", async () => {
    mocks.createResponse.mockRejectedValue(Object.assign(new Error("Private provider details"), {
      name: "APIConnectionTimeoutError"
    }));
    const result = await assessSubmission({
      submissionText: "The fox finds an underwater city.",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toContain("underwater city");
    expect(mocks.createResponse).toHaveBeenCalledTimes(1);
    expect(mocks.createResponse.mock.calls[0][1]).toEqual({ timeout: 15_000, maxRetries: 0 });
    expect(console.warn).toHaveBeenCalledWith("[submission-assessment] using fallback checks", {
      reason: "timeout"
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("Private provider details");
  });

  it("retains safety rejection when assessment is unavailable", async () => {
    mocks.createResponse.mockRejectedValue(new Error("Provider unavailable"));

    const result = await assessSubmission({
      submissionText: "Fill the room with gore.",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("rejected");
    expect(result.flags).toContain("blocked-term");
  });
});

describe("submission assessment camera guidance", () => {
  it("preserves explicit camera direction without imposing a default camera path", () => {
    expect(submissionAssessmentInstructions).toContain(
      "Honor explicit camera direction in the session motion rules or crowd request."
    );
    expect(submissionAssessmentInstructions).toContain(
      "leave it open for movement that serves the requested transformation"
    );
    expect(submissionAssessmentInstructions).not.toContain(
      "rather than the source video's exact composition"
    );
  });
});

describe("heuristicAssessment", () => {
  const session = {
    artistName: "Neon Echo",
    trackName: "Skyline Pressure",
    creativeBible: "Kinetic mirrored architecture and chrome fog.",
    allowedMotifs: "laser lattice, pulse halos, skyline fragments",
    bannedTerms: "celebrity, gore, nudity",
    colorPalette: "teal, ember",
    motionRules: "steady drift",
    basePrompt: "Abstract chrome tunnel with elegant motion."
  };

  it("approves a compatible venue-safe prompt", () => {
    const result = heuristicAssessment({
      submissionText: "Turn the skyline fragments into ember halos with slower breathing light",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.score).toBeGreaterThan(50);
    expect(result.winningPrompt).toContain(session.basePrompt);
  });

  it("rejects blocked content", () => {
    const result = heuristicAssessment({
      submissionText: "Add gore and a celebrity face to the tunnel",
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("rejected");
    expect(result.flags).toContain("blocked-term");
  });

  it("keeps motifs open-ended when the creation toggle is off", () => {
    const result = heuristicAssessment({
      submissionText: "Fill the tunnel with floating paper lanterns",
      session: {
        ...session,
        allowedMotifs: ""
      },
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toContain("Motifs are open-ended");
    expect(result.winningPrompt).not.toContain("Preferred motifs:");
  });

  it("leaves provider camera and loop requirements to final queue composition", () => {
    const result = heuristicAssessment({
      submissionText: "Turn every chrome arch into a tunnel of ember prisms",
      session: {
        ...session,
        motionRules: "Fast clockwise orbit, then a snap zoom on each phrase change"
      },
      recentWinningPrompts: []
    });

    expect(result.winningPrompt).toContain(
      "Turn every chrome arch into a tunnel of ember prisms"
    );
    expect(result.winningPrompt).not.toContain("Follow the artist's motion and camera rules");
    expect(result.winningPrompt).not.toContain("End where the opening can resume");
    expect(result.winningPrompt).not.toContain(
      "Do not preserve the source video's exact composition or camera path"
    );
  });

  it("keeps the heuristic creative body inside the assessment budget", () => {
    const motionRules =
      "Locked-off static camera with no pan, tilt, zoom, dolly, orbit, shake, reframing, or perspective drift";
    const result = heuristicAssessment({
      submissionText:
        "Turn the central mirror into a blooming cobalt portal while ember fragments fold into its rim",
      session: {
        ...session,
        creativeBible: "Reflective dream architecture and volumetric prismatic haze. ".repeat(18),
        allowedMotifs: "mirrors, portals, prisms, halos, lattices, chrome fog, ".repeat(8),
        colorPalette: "cobalt, ember, ultraviolet, warm silver, dusk blue, ".repeat(5),
        motionRules
      },
      recentWinningPrompts: []
    });

    expect(result.winningPrompt).toContain(
      "Turn the central mirror into a blooming cobalt portal"
    );
    expect(result.winningPrompt).not.toContain(motionRules);
    expect(result.winningPrompt.length).toBeLessThanOrEqual(900);
  });
});

describe("assessSubmission in Raw Prompt Mode", () => {
  const session = {
    artistName: "Neon Echo",
    trackName: "Skyline Pressure",
    creativeBible: "Always render mirrored architecture.",
    allowedMotifs: "laser lattice",
    bannedTerms: "celebrity",
    colorPalette: "teal, ember",
    motionRules: "steady drift",
    basePrompt: "Abstract chrome tunnel with elegant motion.",
    venueSafeMode: true,
    artistControlEnabled: false
  };

  it("preserves safe crowd wording without an intake rewrite", async () => {
    const prompt = "Replace everything with hand-painted paper planets and snap zooms";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
    expect(result.winningPrompt).not.toContain(session.artistName);
    expect(result.approvalReason).toContain("original audience wording preserved");
    expect(result.explanation).toContain("source-video-aware director");
  });

  it("ignores the artist banned-term list when artist control is off", async () => {
    const prompt = "A celebrity-shaped constellation made from paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
  });

  it("still enforces the deterministic hard-safety filter when venue-safe mode is on", async () => {
    const prompt = "Fill the tunnel with gore and paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session,
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("rejected");
    expect(result.flags).toContain("blocked-term");
    expect(result.winningPrompt).toBe(prompt);
  });

  it("passes prompts through when both artist control and venue-safe mode are off", async () => {
    const prompt = "Fill the tunnel with gore and paper stars";
    const result = await assessSubmission({
      submissionText: prompt,
      session: {
        ...session,
        venueSafeMode: false
      },
      recentWinningPrompts: []
    });

    expect(result.decision).toBe("approved");
    expect(result.winningPrompt).toBe(prompt);
  });
});
