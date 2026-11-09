export type SubmissionAssessment = {
  decision: "approved";
  score: number;
  flags: string[];
  explanation: string;
  approvalReason: string;
  noveltyScore: number;
  cohesionScore: number;
  remixDeltaScore: number;
  winningPrompt: string;
};

export function acceptRawSubmission(text: string): SubmissionAssessment {
  return {
    decision: "approved",
    score: 100,
    flags: [],
    explanation: "Accepted as written.",
    approvalReason: "Accepted as written.",
    noveltyScore: 100,
    cohesionScore: 100,
    remixDeltaScore: 100,
    winningPrompt: text.trim()
  };
}
