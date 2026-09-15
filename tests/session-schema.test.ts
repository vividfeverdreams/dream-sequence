import { describe, expect, it } from "vitest";
import {
  controlSchema,
  publicSubmissionSchema,
  sessionFormSchema,
  sessionIdeaSchema,
  sessionPrefillSchema
} from "@/lib/schemas";

const validSession = {
  name: "Dream", artistName: "M", trackName: "X", creativeBible: "Dreamlike",
  allowedMotifs: "Fog", bannedTerms: "None", colorPalette: "Blue", motionRules: "Slow",
  basePrompt: "A fox discovers a door in the moon.", videoModel: "h3_max", videoDurationSeconds: 5
};

describe("story setup", () => {
  it("requires only the story opening and supplies valid defaults", () => {
    const result = sessionFormSchema.parse({ basePrompt: "  A fox discovers a door in the moon.  " });
    expect(result).toMatchObject({ basePrompt: validSession.basePrompt, videoModel: "h3_max", videoDurationSeconds: 5, videoResolution: "768P", audienceMode: "web", submissionRateLimitEnabled: true });
  });
  it.each([5, 10, 15])("accepts a supported %s-second clip", (videoDurationSeconds) => {
    expect(sessionFormSchema.safeParse({ ...validSession, videoDurationSeconds }).success).toBe(true);
  });
  it.each([4, 16, 5.5])("rejects unsupported clip length %s", (videoDurationSeconds) => {
    expect(sessionFormSchema.safeParse({ ...validSession, videoDurationSeconds }).success).toBe(false);
  });
  it.each(["480P", "768P", "1080P"])("accepts H3 resolution %s", (videoResolution) => {
    expect(sessionFormSchema.parse({ ...validSession, videoResolution }).videoResolution).toBe(videoResolution);
  });
  it.each(["420P", "720P", "4K"])("rejects unsupported resolution %s", (videoResolution) => {
    expect(sessionFormSchema.safeParse({ ...validSession, videoResolution }).success).toBe(false);
  });
  it.each(["gemini_omni_flash", "seedance2", "seedance2_5", "hailuo3"])("removes legacy model %s", (videoModel) => {
    expect(sessionFormSchema.safeParse({ ...validSession, videoModel }).success).toBe(false);
  });
  it("rejects blank and overlong opening prompts", () => {
    expect(sessionFormSchema.safeParse({ basePrompt: "   " }).success).toBe(false);
    expect(sessionFormSchema.safeParse({ basePrompt: "x".repeat(1201) }).success).toBe(false);
  });
  it("supports Twitch as a distinct input mode", () => {
    expect(sessionFormSchema.parse({ ...validSession, audienceMode: "twitch" }).audienceMode).toBe("twitch");
    expect(sessionFormSchema.safeParse({ ...validSession, audienceMode: "discord" }).success).toBe(false);
  });
});

describe("sessionIdeaSchema", () => {
  it("accepts and trims a plain-English session idea", () => {
    const result = sessionIdeaSchema.safeParse({ idea: "  Blue fog with slow camera movement.  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.idea).toBe("Blue fog with slow camera movement.");
    }
  });

  it("asks for more detail when the idea is too short", () => {
    const result = sessionIdeaSchema.safeParse({ idea: "AI" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Tell us a little more about the session you want to create.");
    }
  });
});

describe("sessionPrefillSchema", () => {
  it("leaves camera behavior open unless the artist explicitly directs it", () => {
    expect(sessionPrefillSchema.shape.motionRules.description).toBe(
      "Artist-directed rhythm and transition guidance. Include a camera style only when the user's idea explicitly asks for one; otherwise leave camera behavior unrestricted."
    );
  });

  it("accepts an AI draft containing every editable creative field", () => {
    const result = sessionPrefillSchema.safeParse({
      name: validSession.name,
      artistName: validSession.artistName,
      trackName: validSession.trackName,
      creativeBible: validSession.creativeBible,
      allowedMotifs: validSession.allowedMotifs,
      bannedTerms: validSession.bannedTerms,
      colorPalette: validSession.colorPalette,
      motionRules: validSession.motionRules,
      basePrompt: validSession.basePrompt
    });

    expect(result.success).toBe(true);
  });

  it("rejects a draft that omits a required answer", () => {
    const result = sessionPrefillSchema.safeParse({
      name: validSession.name,
      artistName: validSession.artistName,
      trackName: validSession.trackName,
      creativeBible: validSession.creativeBible,
      allowedMotifs: validSession.allowedMotifs,
      bannedTerms: validSession.bannedTerms,
      colorPalette: validSession.colorPalette,
      motionRules: validSession.motionRules
    });

    expect(result.success).toBe(false);
  });
});

describe("story continuation submissions", () => {
  const input = { prompt: "The fox opens the door to an underwater city.", participantToken: "device-token-1234567890" };
  it("accepts original free text and an optional nickname", () => {
    expect(publicSubmissionSchema.parse(input)).toMatchObject({ ...input, senderLabel: "Guest" });
    expect(publicSubmissionSchema.parse({ ...input, senderLabel: "Neon Shark" }).senderLabel).toBe("Neon Shark");
  });
  it("rejects missing, blank, very short, and oversized prompts", () => {
    for (const prompt of [undefined, "  ", "next", "x".repeat(1201)]) {
      expect(publicSubmissionSchema.safeParse({ ...input, prompt }).success).toBe(false);
    }
  });
  it("requires a persistent participant token and screen-safe nickname", () => {
    expect(publicSubmissionSchema.safeParse({ ...input, participantToken: "short" }).success).toBe(false);
    expect(publicSubmissionSchema.safeParse({ ...input, senderLabel: "<script>" }).success).toBe(false);
  });
  it("does not accept the removed questionnaire instead of a prompt", () => {
    expect(publicSubmissionSchema.safeParse({ templateId: "choice-style", responseId: "choice-style-1-1", participantToken: input.participantToken }).success).toBe(false);
  });
});

describe("controlSchema", () => {
  it("accepts every wordmark display control", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-overlay",
        value: true
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-opacity",
        value: 0.55
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-size",
        value: 1.2
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-audio-reactive-only",
        value: true
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-progress-overlay",
        value: true
      }).success
    ).toBe(true);
  });

  it("rejects out-of-range wordmark opacity", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-opacity",
        value: 1.1
      }).success
    ).toBe(false);
  });

  it("rejects out-of-range wordmark size", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-size",
        value: 1.6
      }).success
    ).toBe(false);
  });
});
