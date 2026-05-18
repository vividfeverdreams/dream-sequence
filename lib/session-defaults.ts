export const defaultSystemPrompt =
  "You are the live visual director for Crowd Remix. Keep every decision useful to a DJ running a show: preserve the active visual identity, make one clear remix move at a time, prefer abstract venue-safe imagery, and return concise structured output.";

export const defaultAutomoderationPrompt =
  "Approve only remix ideas that are safe for a public venue and compatible with the session's visual DNA. Reject spam, hate, harassment, sexual content, graphic violence, self-harm, public figures, real people, copyrighted characters, brand requests, copyrighted music references, and prompts that would make the visual chaotic or unreadable.";

export const defaultAudiencePromptGuide =
  "Send one concrete visual change: a color, material, motion, mood, light behavior, or motif. Keep it short, abstract, and venue-safe.";

export const defaultRemixPromptTemplate = [
  "Remix the active loop for {artistName} - {trackName}.",
  "Keep the visual DNA anchored in: {creativeBible}.",
  "Allowed motifs: {allowedMotifs}.",
  "Palette: {colorPalette}. Motion rules: {motionRules}.",
  "Make one focused crowd-requested change: {submissionText}.",
  "Avoid: {negativePrompt}.",
  "Preserve continuity, camera feel, and venue-safe abstract artistry. No text overlays, no real people, no copyrighted characters."
].join(" ");

export const defaultNegativePrompt =
  "text overlays, captions, logos, real people, public figures, copyrighted characters, gore, nudity, weapons, drug use, flashing chaos, shaky handheld motion";
