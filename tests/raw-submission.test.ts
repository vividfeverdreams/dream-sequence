import { describe, expect, it } from "vitest";
import { acceptRawSubmission } from "@/lib/raw-submission";

describe("raw submissions", () => {
  it.each(["A river of blood becomes roses.", "gore", "  Keep  these\nwords, exactly!  ", "", "x".repeat(1200)])(
    "always approves the original words: %j", (text) => {
      expect(acceptRawSubmission(text)).toEqual({
        decision: "approved", score: 100, flags: [],
        explanation: "Accepted as written.", approvalReason: "Accepted as written.",
        noveltyScore: 100, cohesionScore: 100, remixDeltaScore: 100,
        winningPrompt: text.trim()
      });
    }
  );
});
