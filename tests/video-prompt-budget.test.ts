import { describe, expect, it } from "vitest";
import {
  composeFinalProviderVideoPrompt,
  composeVideoPrompt,
  providerArtistCameraPriorityRequirement,
  providerCameraContinuityRequirement,
  providerCrowdReferenceRequirement,
  providerOpeningFrameContinuityRequirement,
  providerSeamlessLoopRequirement,
  videoProviderPromptCharacterBudget
} from "@/lib/video-prompt-budget";

describe("video prompt budget composition", () => {
  it("shortens only context and preserves every required clause intact", () => {
    const cameraRequirement =
      "Keep the camera locked in a completely static wide frame.";
    const loopRequirement =
      "Maintain seamless-loop continuity and venue-safe imagery.";
    const prompt = composeVideoPrompt({
      context: ["Detailed visual context. ".repeat(100)],
      requirements: [cameraRequirement, loopRequirement]
    });

    expect(prompt.length).toBeLessThanOrEqual(
      videoProviderPromptCharacterBudget
    );
    expect(prompt).toContain(cameraRequirement);
    expect(prompt).toContain(loopRequirement);
    expect(prompt.endsWith(`${cameraRequirement} ${loopRequirement}`)).toBe(true);
  });

  it("fails closed instead of silently truncating required clauses", () => {
    expect(() =>
      composeVideoPrompt({
        context: ["optional context"],
        requirements: ["required ".repeat(30)],
        maxLength: 100
      })
    ).toThrow("Required video prompt clauses exceed the 100-character budget.");
  });

  it("keeps the attached closing-frame instruction at character zero under truncation", () => {
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt: "Hostile optional context. ".repeat(100),
      motionRules: "Keep motion fluid",
      includeArtistMotionRules: true,
      openingFrameAttached: true,
      crowdReferenceAttached: true
    });

    expect(prompt.startsWith(providerOpeningFrameContinuityRequirement)).toBe(
      true
    );
    expect(prompt).toContain(providerCrowdReferenceRequirement);
    expect(prompt).toContain(providerSeamlessLoopRequirement);
    expect(prompt.length).toBeLessThanOrEqual(
      videoProviderPromptCharacterBudget
    );
  });

  it("does not claim an opening image is attached when none is available", () => {
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt: "Continue the luminous architecture.",
      includeArtistMotionRules: false,
      openingFrameAttached: false,
      crowdReferenceAttached: true
    });

    expect(prompt).not.toContain(providerOpeningFrameContinuityRequirement);
    expect(prompt).not.toContain(providerCrowdReferenceRequirement);
  });

  it("does not split a UTF-16 surrogate pair at the context boundary", () => {
    const prompt = composeVideoPrompt({
      context: [`${"x".repeat(49)}🎥 trailing context`],
      requirements: ["required"],
      maxLength: 59
    });

    expect(prompt.length).toBeLessThanOrEqual(59);
    expect(prompt).not.toContain("\uD83C");
    expect(prompt).not.toContain("\uDFA5");
    expect(prompt).toContain("required");
  });

  it.each([
    "Locked-off static frame for the entire loop",
    "Aggressive handheld push-ins with rapid clockwise orbiting turns"
  ])("preserves enabled artist camera rules and gives them conflict priority: %s", (motionRules) => {
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt:
        "The crowd requests a slow dolly backward through a prismatic city. ".repeat(20),
      motionRules,
      includeArtistMotionRules: true
    });

    expect(prompt).toContain("slow dolly backward");
    expect(prompt).toContain(motionRules);
    expect(prompt).toContain(providerArtistCameraPriorityRequirement);
    expect(prompt).toContain(providerSeamlessLoopRequirement);
    expect(prompt).not.toContain("Venue-safe:");
    expect(prompt.length).toBeLessThanOrEqual(
      videoProviderPromptCharacterBudget
    );
  });

  it("preserves crowd camera direction without adding disabled artist rules", () => {
    const artistRuleSentinel = "ARTIST_LOCKED_CAMERA_SENTINEL";
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt: "Use a fast clockwise audience-requested orbit.",
      motionRules: artistRuleSentinel,
      includeArtistMotionRules: false
    });

    expect(prompt).toContain("fast clockwise audience-requested orbit");
    expect(prompt).not.toContain(artistRuleSentinel);
    expect(prompt).toContain(providerCameraContinuityRequirement);
    expect(prompt).toContain(providerSeamlessLoopRequirement);
    expect(prompt).not.toContain("Venue-safe:");
  });

  it("does not invent a camera choice when neither prompt nor rules specify one", () => {
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt: "Pulse the prism geometry on every phrase change.",
      motionRules: "Dissolve cleanly between forms",
      includeArtistMotionRules: true
    });

    expect(prompt).toContain("if neither specifies camera, leave it unrestricted");
    expect(prompt).not.toMatch(/\b(?:orbit|dolly|pan|zoom|locked|static)\b/i);
  });

  it("retains at least 300 creative characters with maximum-length artist rules", () => {
    const prompt = composeFinalProviderVideoPrompt({
      creativePrompt: "C".repeat(900),
      motionRules: "R".repeat(300),
      includeArtistMotionRules: true
    });
    const retainedCreativeCharacters = prompt.match(/^C+/)?.[0].length ?? 0;

    expect(retainedCreativeCharacters).toBeGreaterThanOrEqual(300);
    expect(prompt).toContain("R".repeat(300));
    expect(prompt).toContain(providerArtistCameraPriorityRequirement);
    expect(prompt).toContain(providerSeamlessLoopRequirement);
    expect(prompt).not.toContain("Venue-safe:");
    expect(prompt.length).toBeLessThanOrEqual(
      videoProviderPromptCharacterBudget
    );
  });
});
