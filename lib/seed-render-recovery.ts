type SeedRenderRecoveryCandidate = {
  mode?: string;
  status?: string;
  submissionId?: string | null;
  providerStrategy?: string | null;
  providerRequestId?: string | null;
  providerOutputUri?: string | null;
  outputAsset?: { status?: string } | null;
};

export const recoverableSeedFailureMessage =
  "The video finished generating, but could not be prepared for playback. Recover the existing clip.";

export function canRecoverSeedRender(job: SeedRenderRecoveryCandidate | null | undefined) {
  return Boolean(
    job?.mode === "seed" &&
    job.status === "failed" &&
    job.submissionId == null &&
    job.providerStrategy?.startsWith("fal_") &&
    job.providerRequestId?.trim() &&
    job.providerOutputUri?.trim() &&
    job.outputAsset?.status === "failed"
  );
}

export function classifySeedPreparationFailure(failureReason: string | null | undefined) {
  if (/could not load the node-av native binding/i.test(failureReason ?? "")) return "NATIVE_BINDING_UNAVAILABLE";
  if (/supabase|storage/i.test(failureReason ?? "")) return "STORAGE_PREPARATION_FAILED";
  if (/invalid.*(?:metadata|video dimensions|duration)|metadata.*invalid/i.test(failureReason ?? "")) return "INVALID_VIDEO_METADATA";
  return "PREPARATION_FAILED";
}
