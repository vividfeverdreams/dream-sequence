export type AutomaticCueDecision = "ignore" | "wait-for-remix" | "take-remix";
export type ManualTakeDecision =
  | "ignore"
  | "wait-for-asset"
  | "acknowledge-active"
  | "take-asset";
export type VideoSlotIndex = 0 | 1;
export type ShowPlaybackCandidateSource =
  | "authoritative-current"
  | "manual-request"
  | "authoritative-next"
  | "local-rotation";

export type ShowPlaybackCandidate<Asset> = {
  asset: Asset;
  source: ShowPlaybackCandidateSource;
};

export type PlaybackRotationAsset = {
  id: string;
  kind?: string | null;
  createdAt: Date | string;
};

type PlaybackIntroductionAsset = {
  id: string;
  status?: string | null;
} | null;

export const playbackRotationSize = 3;

const automaticPlaybackTransitionLeadSeconds = 0.5;
const maximumStandbyRetryDelayMs = 10_000;

function comparePlaybackAssets(
  left: PlaybackRotationAsset,
  right: PlaybackRotationAsset
) {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
  const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : 0;

  return normalizedLeftTime - normalizedRightTime || left.id.localeCompare(right.id);
}

export function getChronologicalPlaybackRotation<
  Asset extends PlaybackRotationAsset
>(assets: Asset[], rotationSize = playbackRotationSize) {
  if (rotationSize <= 0) {
    return [] as Asset[];
  }

  const chronologicalAssets = [...assets].sort(comparePlaybackAssets);

  if (chronologicalAssets.length <= 1) {
    return chronologicalAssets;
  }

  const originalAsset =
    chronologicalAssets.find((asset) => asset.kind === "seed") ??
    chronologicalAssets[0];
  const remixAssets = chronologicalAssets.filter(
    (asset) => asset.id !== originalAsset?.id
  );

  if (remixAssets.length < rotationSize) {
    return originalAsset
      ? [originalAsset, ...remixAssets].slice(0, rotationSize)
      : remixAssets.slice(0, rotationSize);
  }

  return remixAssets.slice(-rotationSize);
}

export function getNextPlaybackRotationAsset<
  Asset extends PlaybackRotationAsset
>(
  assets: Asset[],
  currentAssetId: string | null | undefined,
  rotationSize = playbackRotationSize
) {
  const rotation = getChronologicalPlaybackRotation(assets, rotationSize);

  if (rotation.length <= 1) {
    return null;
  }

  const currentIndex = rotation.findIndex(
    (asset) => asset.id === currentAssetId
  );

  if (currentIndex < 0) {
    return rotation[0] ?? null;
  }

  return rotation[(currentIndex + 1) % rotation.length] ?? null;
}

export function getIntroducedPlaybackAssetIds(
  assets: PlaybackIntroductionAsset[],
  currentAssetId?: string | null
) {
  const introducedAssetIds = new Set<string>();

  if (currentAssetId) {
    introducedAssetIds.add(currentAssetId);
  }

  for (const asset of assets) {
    if (asset?.id && (asset.status === "live" || asset.status === "archived")) {
      introducedAssetIds.add(asset.id);
    }
  }

  return introducedAssetIds;
}

export function acknowledgeAuthoritativePlaybackAsset(
  currentAssetId: string | null | undefined,
  pendingIntroductionAssetId: string | null | undefined,
  introducedAssetIds: Set<string>
) {
  if (!currentAssetId) {
    return false;
  }

  introducedAssetIds.add(currentAssetId);

  return pendingIntroductionAssetId === currentAssetId;
}

export function shouldShowPlaybackIntroduction(
  asset: {
    id: string;
    status?: string | null;
  },
  introducedAssetIds: ReadonlySet<string>
) {
  return Boolean(
    asset.id &&
      (asset.status === "ready" || asset.status === "live") &&
      !introducedAssetIds.has(asset.id)
  );
}

export function getAuthoritativePlaybackCandidate<
  Asset extends {
    id: string;
  }
>(
  currentAsset: Asset | null,
  activeAssetId: string | null | undefined,
  queuedNextAssetId?: string | null,
  locallyAdvancedAssetId?: string | null,
  localRotationAuthoritativeAssetId?: string | null
) {
  if (
    activeAssetId &&
    queuedNextAssetId === activeAssetId &&
    locallyAdvancedAssetId === activeAssetId
  ) {
    return null;
  }

  if (
    currentAsset?.id &&
    currentAsset.id === localRotationAuthoritativeAssetId
  ) {
    return null;
  }

  return currentAsset?.id && currentAsset.id !== activeAssetId
    ? currentAsset
    : null;
}

export function getAuthoritativeNextPlaybackCandidate<
  Asset extends {
    id: string;
  }
>({
  currentAssetId,
  activeAssetId,
  nextAsset,
  localRotationAuthoritativeAssetId
}: {
  currentAssetId: string | null | undefined;
  activeAssetId: string | null | undefined;
  nextAsset: Asset | null;
  localRotationAuthoritativeAssetId: string | null | undefined;
}) {
  if (!nextAsset?.id || nextAsset.id === activeAssetId) {
    return null;
  }

  const displayMatchesAuthoritativePlayback = currentAssetId === activeAssetId;
  const displayIsLocallyRotating = Boolean(
    currentAssetId &&
      currentAssetId === localRotationAuthoritativeAssetId
  );

  return displayMatchesAuthoritativePlayback || displayIsLocallyRotating
    ? nextAsset
    : null;
}

export function shouldCommitVisibleAuthoritativeNext({
  currentAssetId,
  activeAssetId,
  nextAssetId,
  localRotationAuthoritativeAssetId,
  playbackMutationsEnabled
}: {
  currentAssetId: string | null | undefined;
  activeAssetId: string | null | undefined;
  nextAssetId: string | null | undefined;
  localRotationAuthoritativeAssetId: string | null | undefined;
  playbackMutationsEnabled: boolean;
}) {
  return Boolean(
    playbackMutationsEnabled &&
      currentAssetId &&
      currentAssetId !== activeAssetId &&
      currentAssetId === localRotationAuthoritativeAssetId &&
      nextAssetId &&
      nextAssetId === activeAssetId
  );
}

export function shouldHoldPlaybackForAuthoritativeCommit({
  awaitingAssetId,
  baselineCurrentAssetId,
  currentAssetId,
  playbackMutationsEnabled
}: {
  awaitingAssetId: string | null | undefined;
  baselineCurrentAssetId: string | null | undefined;
  currentAssetId: string | null | undefined;
  playbackMutationsEnabled: boolean;
}) {
  return Boolean(
    playbackMutationsEnabled &&
      awaitingAssetId &&
      currentAssetId !== awaitingAssetId &&
      (currentAssetId ?? null) === (baselineCurrentAssetId ?? null)
  );
}

export function getShowPlaybackCandidate<Asset>({
  authoritativeCurrentAsset,
  requestedAsset,
  authoritativeNextAsset,
  localRotationAsset,
  isMonitor,
  holdForAuthoritativeCommit = false
}: {
  authoritativeCurrentAsset: Asset | null;
  requestedAsset: Asset | null;
  authoritativeNextAsset: Asset | null;
  localRotationAsset: Asset | null;
  isMonitor: boolean;
  holdForAuthoritativeCommit?: boolean;
}): ShowPlaybackCandidate<Asset> | null {
  if (holdForAuthoritativeCommit) {
    return null;
  }

  if (authoritativeCurrentAsset) {
    return {
      asset: authoritativeCurrentAsset,
      source: "authoritative-current"
    };
  }

  if (!isMonitor && requestedAsset) {
    return {
      asset: requestedAsset,
      source: "manual-request"
    };
  }

  if (!isMonitor && authoritativeNextAsset) {
    return {
      asset: authoritativeNextAsset,
      source: "authoritative-next"
    };
  }

  return localRotationAsset
    ? {
        asset: localRotationAsset,
        source: "local-rotation"
      }
    : null;
}

export function decideManualTakeRequest({
  requestId,
  handledRequestId,
  selectedAssetId,
  activeAssetId
}: {
  requestId: string | null | undefined;
  handledRequestId: string | null | undefined;
  selectedAssetId: string | null | undefined;
  activeAssetId: string | null | undefined;
}): ManualTakeDecision {
  if (!requestId || requestId === handledRequestId) {
    return "ignore";
  }

  if (!selectedAssetId) {
    return "wait-for-asset";
  }

  return selectedAssetId === activeAssetId
    ? "acknowledge-active"
    : "take-asset";
}

export function shouldCommitShowPlaybackTransition({
  source,
  playbackMutationsEnabled
}: {
  source: ShowPlaybackCandidateSource;
  playbackMutationsEnabled: boolean;
}) {
  return (
    playbackMutationsEnabled &&
    (source === "manual-request" || source === "authoritative-next")
  );
}

export function shouldStartAutomaticPlaybackTransition({
  isMonitor,
  activeSlot,
  audioSyncConnected,
  nextAssetReady,
  transitionInFlight,
  currentTime,
  duration
}: {
  isMonitor: boolean;
  activeSlot: boolean;
  audioSyncConnected: boolean;
  nextAssetReady: boolean;
  transitionInFlight: boolean;
  currentTime: number;
  duration: number;
}) {
  if (
    isMonitor ||
    !activeSlot ||
    audioSyncConnected ||
    !nextAssetReady ||
    transitionInFlight
  ) {
    return false;
  }

  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    currentTime < 0 ||
    duration <= 0 ||
    currentTime > duration
  ) {
    return false;
  }

  return duration - currentTime <= automaticPlaybackTransitionLeadSeconds;
}

export function decideAutomaticCueTransition({
  autoTakeOnCue,
  nextAssetReady
}: {
  autoTakeOnCue: boolean;
  nextAssetReady: boolean;
}): AutomaticCueDecision {
  if (!autoTakeOnCue) {
    return "ignore";
  }

  return nextAssetReady ? "take-remix" : "wait-for-remix";
}

export function isCueSyncedPlaybackActive({
  audioSyncConnected,
  autoTakeOnCue
}: {
  audioSyncConnected: boolean;
  autoTakeOnCue: boolean;
}) {
  return audioSyncConnected && autoTakeOnCue;
}

export function getTypewriterChunkSize(characterCount: number) {
  if (characterCount <= 0) {
    return 0;
  }

  return Math.max(3, Math.ceil(characterCount / 110));
}

export function getAudienceFacingRemixPrompt(rawSubmissionText: string | null | undefined) {
  return rawSubmissionText?.trim() || "New remix incoming.";
}

export function getPlaybackAttribution(asset: {
  promptText?: string | null;
  sourceSubmission?: {
    rawText?: string | null;
    sender?: string | null;
    source?: string | null;
  } | null;
} | null) {
  const sourceSubmission = asset?.sourceSubmission;
  const webNickname =
    sourceSubmission?.source === "web"
      ? sourceSubmission.sender?.trim()
      : null;

  return {
    nickname:
      webNickname ||
      (sourceSubmission ? "CROWD REMIX" : "DREAM SEQUENCE"),
    promptText:
      sourceSubmission?.rawText?.trim() ||
      asset?.promptText?.trim() ||
      "Original session visual"
  };
}

export function shouldAdvancePlaybackAtVideoEnd({
  activeSlotEnded,
  audioSyncConnected,
  nextAssetReady
}: {
  activeSlotEnded: boolean;
  audioSyncConnected: boolean;
  nextAssetReady: boolean;
}) {
  return activeSlotEnded && !audioSyncConnected && nextAssetReady;
}

export function shouldHandoffPreparedPlaybackAtBoundary({
  isMonitor,
  localRotation,
  audioSyncConnected,
  candidateAssetId,
  authorizedAssetId
}: {
  isMonitor: boolean;
  localRotation?: boolean;
  audioSyncConnected: boolean;
  candidateAssetId: string | null;
  authorizedAssetId: string | null;
}) {
  if (!candidateAssetId) {
    return false;
  }

  return (
    isMonitor ||
    localRotation ||
    !audioSyncConnected ||
    authorizedAssetId === candidateAssetId
  );
}

export function getStandbyVideoSlot(activeSlot: VideoSlotIndex): VideoSlotIndex {
  return activeSlot === 0 ? 1 : 0;
}

export function getStandbyRetryDelayMs(attempt: number) {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(1, Math.floor(attempt))
    : 1;

  return Math.min(normalizedAttempt * 750, maximumStandbyRetryDelayMs);
}

export function getRenderableVideoSlots<Slot>(
  videoSlots: [Slot | null, Slot | null],
  activeSlot: VideoSlotIndex,
  currentAssetSlot: Slot | null
): [Slot | null, Slot | null] {
  if (videoSlots[activeSlot] || !currentAssetSlot) {
    return videoSlots;
  }

  return activeSlot === 0
    ? [currentAssetSlot, videoSlots[1]]
    : [videoSlots[0], currentAssetSlot];
}

export function isVideoSlotVisible({
  slot,
  activeSlot,
  incomingSlot
}: {
  slot: VideoSlotIndex;
  activeSlot: VideoSlotIndex;
  incomingSlot: VideoSlotIndex | null;
}) {
  return slot === activeSlot || slot === incomingSlot;
}
