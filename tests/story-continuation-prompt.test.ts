import { describe, expect, it } from "vitest";
import { buildIdleStoryBeat } from "@/lib/story-continuation-prompt";

describe("built-in idle story beats", () => {
  const input = { recentPrompts: [], continuationNumber: 1 };

  it("returns one beat synchronously with no added instructions", () => {
    expect(buildIdleStoryBeat(input)).toBe(
      "A narrow trail of light appears beside the current focal subject and leads into a newly revealed passage."
    );
  });

  it("rotates through all eight original beats and wraps around", () => {
    const beats = Array.from({ length: 8 }, (_, index) =>
      buildIdleStoryBeat({ ...input, continuationNumber: index + 1 })
    );
    expect(new Set(beats).size).toBe(8);
    for (const beat of beats) expect(beat.match(/[.!?]/g)).toHaveLength(1);
    expect(buildIdleStoryBeat({ ...input, continuationNumber: 9 })).toBe(beats[0]);
  });

  it("avoids recent beats regardless of case", () => {
    const previousBeat = buildIdleStoryBeat(input);
    expect(buildIdleStoryBeat({ ...input, recentPrompts: [previousBeat.toUpperCase()] })).toBe(
      buildIdleStoryBeat({ ...input, continuationNumber: 2 })
    );
  });

  it("still rotates when all eight beats were used recently", () => {
    const recentPrompts = Array.from({ length: 8 }, (_, index) =>
      buildIdleStoryBeat({ ...input, continuationNumber: index + 1 })
    );
    expect(buildIdleStoryBeat({ recentPrompts, continuationNumber: 3 })).toBe(recentPrompts[2]);
  });

  it.each([NaN, Infinity, -1, 0, 1.9])("handles continuation number %s", (continuationNumber) => {
    expect(buildIdleStoryBeat({ ...input, continuationNumber })).toBe(buildIdleStoryBeat(input));
  });
});
