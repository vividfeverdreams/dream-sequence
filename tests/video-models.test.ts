import { describe, expect, it } from "vitest";
import {
  defaultVideoModelId, defaultVideoResolution, getVideoDurationOptions,
  getVideoModelDefinition, isVideoModelDurationSupported, isVideoModelId,
  isVideoResolution, normalizeVideoDurationSecondsForModel, normalizeVideoModelId,
  normalizeVideoResolution, videoModelIds, videoResolutions
} from "@/lib/video-models";
import { defaultVideoDurationSeconds, formatVideoDuration, isVideoDurationSeconds, videoDurationOptions } from "@/lib/video-duration";

describe("H3 Max model capabilities", () => {
  it("exposes only H3 Max and migrates legacy model values to it", () => {
    expect(videoModelIds).toEqual(["h3_max"]);
    expect(defaultVideoModelId).toBe("h3_max");
    expect(getVideoModelDefinition("h3_max").label).toBe("H3 Max");
    for (const legacy of ["gemini_omni_flash", "hailuo3", "seedance2", "seedance2_5"]) {
      expect(isVideoModelId(legacy)).toBe(false);
      expect(normalizeVideoModelId(legacy)).toBe("h3_max");
    }
  });
  it("supports every whole-second duration from 5 to 15", () => {
    const durations = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    expect(getVideoDurationOptions("h3_max")).toEqual(durations);
    expect(videoDurationOptions).toEqual(durations);
    for (const seconds of durations) expect(isVideoDurationSeconds(seconds)).toBe(true);
    for (const seconds of [4, 16, 5.5, NaN]) expect(isVideoModelDurationSupported("h3_max", seconds)).toBe(false);
    expect(normalizeVideoDurationSecondsForModel("h3_max", 30)).toBe(defaultVideoDurationSeconds);
    expect(formatVideoDuration(12)).toBe("12s");
  });
  it("uses the exact fal output quality options", () => {
    expect(videoResolutions).toEqual(["480P", "768P", "1080P"]);
    expect(defaultVideoResolution).toBe("768P");
    for (const resolution of videoResolutions) expect(isVideoResolution(resolution)).toBe(true);
    expect(isVideoResolution("720P")).toBe(false);
    expect(isVideoResolution("420P")).toBe(false);
    expect(normalizeVideoResolution(undefined)).toBe("768P");
  });
});
