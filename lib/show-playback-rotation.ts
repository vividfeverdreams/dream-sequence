import {
  getNextPlaybackRotationAsset,
  type PlaybackRotationAsset
} from "./remix-transition";

export const showPlaybackRotationSize = 5;

type ShowRotationAsset = PlaybackRotationAsset & {
  status?: string | null;
};

/** Keep the five-video loop separate from remixes awaiting their first take. */
export function getShowPlaybackRotationAsset<Asset extends ShowRotationAsset>(
  assets: Asset[],
  activeAssetId: string | null | undefined,
  introducedAssetIds: ReadonlySet<string>
) {
  const rotationAssets = assets.filter(
    (asset) =>
      asset.id === activeAssetId ||
      asset.status === "live" ||
      asset.status === "archived" ||
      introducedAssetIds.has(asset.id)
  );

  return getNextPlaybackRotationAsset(
    rotationAssets,
    activeAssetId,
    showPlaybackRotationSize
  );
}

/** A pending cue gates the new remix, not the existing video's rotation. */
export function getCueReadyPlaybackAsset<Asset extends { id: string }>(
  queuedAsset: Asset | null,
  cueSyncActive: boolean,
  authorizedAssetId: string | null | undefined
): Asset | null {
  if (
    queuedAsset &&
    cueSyncActive &&
    queuedAsset.id !== authorizedAssetId
  ) {
    return null;
  }

  return queuedAsset;
}
