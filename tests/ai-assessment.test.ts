import { describe, expect, it } from "vitest";
import { heuristicAssessment } from "@/lib/ai-assessment";

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
    expect(result.winningPrompt).toContain("Neon Echo");
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

  it("uses a session-specific remix prompt template", () => {
    const result = heuristicAssessment({
      submissionText: "make the pulse halos turn silver on the drop",
      session: {
        ...session,
        remixPromptTemplate:
          "CUSTOM TEMPLATE for {artistName}: crowd asked for {submissionText}; avoid {negativePrompt}.",
        negativePrompt: "logos and text"
      },
      recentWinningPrompts: []
    });

    expect(result.winningPrompt).toContain("CUSTOM TEMPLATE");
    expect(result.winningPrompt).toContain("logos and text");
  });
});
