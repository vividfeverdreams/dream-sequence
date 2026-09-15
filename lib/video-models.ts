export const videoModelIds = ["h3_max"] as const;

export type VideoModelId = (typeof videoModelIds)[number];

export type VideoModelDefinition = {
  id: VideoModelId;
  label: string;
  description: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  defaultDurationSeconds: number;
};

export const defaultVideoModelId: VideoModelId = "h3_max";

// Verified against fal's H3 Max input schema: 5–15 whole seconds.
export const videoModelDefinitions: readonly VideoModelDefinition[] = [
  {
    id: "h3_max",
    label: "H3 Max",
    description: "A continuous story, generated with H3 Max on fal.ai.",
    minDurationSeconds: 5,
    maxDurationSeconds: 15,
    defaultDurationSeconds: 5
  }
];

export const videoResolutions = ["480P", "768P", "1080P"] as const;
export type VideoResolution = (typeof videoResolutions)[number];
export const defaultVideoResolution: VideoResolution = "768P";

export function isVideoResolution(value: unknown): value is VideoResolution {
  return typeof value === "string" && (videoResolutions as readonly string[]).includes(value);
}

export function normalizeVideoResolution(value: unknown): VideoResolution {
  return isVideoResolution(value) ? value : defaultVideoResolution;
}

const videoModelDefinitionsById = new Map(
  videoModelDefinitions.map((definition) => [definition.id, definition])
);

export function isVideoModelId(value: unknown): value is VideoModelId {
  return (
    typeof value === "string" &&
    (videoModelIds as readonly string[]).includes(value)
  );
}

export function normalizeVideoModelId(value: unknown): VideoModelId {
  return isVideoModelId(value) ? value : defaultVideoModelId;
}

export function getVideoModelDefinition(
  videoModel: VideoModelId
): VideoModelDefinition;
export function getVideoModelDefinition(
  videoModel: unknown
): VideoModelDefinition | undefined;
export function getVideoModelDefinition(
  videoModel: unknown
): VideoModelDefinition | undefined {
  return isVideoModelId(videoModel)
    ? videoModelDefinitionsById.get(videoModel)
    : undefined;
}

export function getVideoDurationOptions(
  videoModel: VideoModelId
): readonly number[] {
  const definition = getVideoModelDefinition(videoModel);

  return Array.from(
    {
      length:
        definition.maxDurationSeconds -
        definition.minDurationSeconds +
        1
    },
    (_, index) => definition.minDurationSeconds + index
  );
}

export function isVideoModelDurationSupported(
  videoModel: unknown,
  durationSeconds: unknown
): durationSeconds is number {
  const definition = getVideoModelDefinition(videoModel);

  return (
    definition !== undefined &&
    typeof durationSeconds === "number" &&
    Number.isInteger(durationSeconds) &&
    durationSeconds >= definition.minDurationSeconds &&
    durationSeconds <= definition.maxDurationSeconds
  );
}

export function getVideoDurationForModelChange(
  videoModel: VideoModelId,
  currentDurationSeconds: unknown
): number {
  if (isVideoModelDurationSupported(videoModel, currentDurationSeconds)) {
    return currentDurationSeconds;
  }

  return getVideoModelDefinition(videoModel).defaultDurationSeconds;
}

export function normalizeVideoDurationSecondsForModel(
  videoModel: unknown,
  durationSeconds: unknown
): number {
  return getVideoDurationForModelChange(
    normalizeVideoModelId(videoModel),
    durationSeconds
  );
}

// These aliases support both common model/duration naming styles.
export const getVideoDurationOptionsForModel = getVideoDurationOptions;
export const isVideoDurationSupportedForModel =
  isVideoModelDurationSupported;
export const resolveVideoDurationForModelChange =
  getVideoDurationForModelChange;
