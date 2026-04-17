export const SESSION_STATUSES = ["draft", "live", "stopped"] as const;
export const SUBMISSION_STATUSES = [
  "submitted",
  "approved",
  "rejected",
  "queued",
  "rendering",
  "ready",
  "live",
  "failed"
] as const;
export const RENDER_STATUSES = ["queued", "in_progress", "completed", "failed"] as const;
export const PLAYBACK_STATUSES = ["idle", "holding", "live", "transitioning"] as const;
