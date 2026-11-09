export const videoModerationBlockedReason =
  "The video provider blocked this render during moderation.";
export const videoProviderFailureReason =
  "The video provider could not complete this render.";

const legacyGeminiModerationBlockedReason =
  "Gemini Omni blocked this render during video moderation.";
const legacyGrokModerationBlockedReason =
  "Grok Imagine blocked this render during video moderation.";
const maximumProviderFailureCodeLength = 128;

export type VideoModerationDiagnostic =
  | "input_text"
  | "input_image"
  | "input_video"
  | "input_media"
  | "generated_output"
  | "provider_safety";

export function normalizeProviderFailureCode(code: unknown) {
  const normalized =
    typeof code === "string"
      ? code.trim()
      : typeof code === "number" && Number.isFinite(code)
        ? String(code)
        : "";

  return normalized
    ? normalized.slice(0, maximumProviderFailureCodeLength)
    : null;
}

export function getVideoModerationDiagnostic(
  providerFailureCode: string | null | undefined
): VideoModerationDiagnostic | null {
  const normalized = normalizeProviderFailureCode(providerFailureCode)?.toUpperCase();

  if (!normalized || !isProviderModerationFailureCode(normalized)) {
    return null;
  }

  if (normalized.includes(".OUTPUT")) {
    return "generated_output";
  }

  if (
    normalized.includes(".INPUT") ||
    normalized.startsWith("INPUT_PREPROCESSING.SAFETY")
  ) {
    if (normalized.includes(".IMAGE")) {
      return "input_image";
    }

    if (normalized.includes(".VIDEO")) {
      return "input_video";
    }

    if (normalized.includes(".TEXT")) {
      return "input_text";
    }

    return "input_media";
  }

  return "provider_safety";
}

export function getVideoModerationDiagnosticLabel(
  diagnostic: VideoModerationDiagnostic
) {
  switch (diagnostic) {
    case "input_text":
      return "The submitted prompt may have triggered the provider safety filter.";
    case "input_image":
      return "An attached image may have triggered the provider safety filter.";
    case "input_video":
      return "The source video may have triggered the provider safety filter.";
    case "input_media":
      return "One of the request inputs may have triggered the provider safety filter.";
    case "generated_output":
      return "The generated output was blocked by the provider safety filter.";
    case "provider_safety":
      return "The provider safety filter did not identify a specific input.";
  }
}

export function isVideoModerationFailureReason(
  failureReason: string | null | undefined
) {
  return Boolean(
    failureReason &&
      [
        videoModerationBlockedReason,
        legacyGeminiModerationBlockedReason,
        legacyGrokModerationBlockedReason
      ].some(
        (reason) => failureReason === reason || failureReason.startsWith(`${reason} `)
      )
  );
}

function isProviderModerationFailureCode(code: string) {
  return (
    code === "SAFETY" ||
    code.startsWith("SAFETY.") ||
    code === "INPUT_PREPROCESSING.SAFETY" ||
    code.startsWith("INPUT_PREPROCESSING.SAFETY.")
  );
}
