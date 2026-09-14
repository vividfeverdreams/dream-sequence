import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  getAuthoritativeNextPlaybackCandidate,
  getAuthoritativePlaybackCandidate,
  getShowPlaybackCandidate,
  isCueSyncedPlaybackActive,
  shouldCommitShowPlaybackTransition,
  shouldHandoffPreparedPlaybackAtBoundary
} from "../lib/remix-transition";
import {
  getCueReadyPlaybackAsset,
  getShowPlaybackRotationAsset,
  showPlaybackRotationSize
} from "../lib/show-playback-rotation";

function asset(index: number, status = "archived") {
  return {
    id: index === 0 ? "seed" : `remix-${index}`,
    kind: index === 0 ? "seed" : "remix",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    status
  };
}

type Asset = ReturnType<typeof asset>;

function cycle(
  assets: Asset[],
  activeId: string,
  steps: number,
  introduced = new Set<string>()
) {
  const ids: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    const next = getShowPlaybackRotationAsset(assets, activeId, introduced);
    assert.ok(next);
    ids.push(next.id);
    activeId = next.id;
  }
  return ids;
}

describe("five-video show rotation", () => {
  it("keeps a fixed five-video limit", () => {
    assert.equal(showPlaybackRotationSize, 5);
  });

  it("wraps from the fifth clip to the first over three full cycles", () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset(index));
    const expected = ["remix-1", "remix-2", "remix-3", "remix-4", "seed"];
    assert.deepEqual(cycle(assets, "seed", 15), [...expected, ...expected, ...expected]);
  });

  it("uses only the latest five remixes when the archive grows", () => {
    const assets = Array.from({ length: 9 }, (_, index) => asset(index));
    const expected = ["remix-4", "remix-5", "remix-6", "remix-7", "remix-8"];
    assert.deepEqual(cycle(assets, "remix-8", 10), [...expected, ...expected]);
  });

  it("keeps an unintroduced ready remix out of the existing loop", () => {
    const assets = [...Array.from({ length: 5 }, (_, index) => asset(index)), asset(5, "ready")];
    assert.deepEqual(cycle(assets, "remix-4", 5), [
      "seed", "remix-1", "remix-2", "remix-3", "remix-4"
    ]);
  });

  it("admits a newly introduced remix and retires the oldest clip", () => {
    const assets = [...Array.from({ length: 5 }, (_, index) => asset(index)), asset(5, "ready")];
    assert.deepEqual(cycle(assets, "remix-5", 5, new Set(["remix-5"])), [
      "remix-1", "remix-2", "remix-3", "remix-4", "remix-5"
    ]);
  });

  it("includes the visible ready clip before the server updates its status", () => {
    const assets = [asset(0), asset(1, "ready")];
    assert.equal(getShowPlaybackRotationAsset(assets, "remix-1", new Set())?.id, "seed");
  });

  it("cycles the available clips when fewer than five exist", () => {
    assert.deepEqual(cycle([asset(0), asset(1)], "seed", 4), [
      "remix-1", "seed", "remix-1", "seed"
    ]);
  });

  it("returns no next candidate for empty or single-video rotations", () => {
    assert.equal(getShowPlaybackRotationAsset([], null, new Set()), null);
    assert.equal(getShowPlaybackRotationAsset([asset(0)], "seed", new Set()), null);
  });

  it("orders the rotation chronologically without mutating the snapshot", () => {
    const assets = [asset(4), asset(2), asset(0), asset(3), asset(1)];
    const originalIds = assets.map((item) => item.id);
    assert.deepEqual(cycle(assets, "seed", 5), [
      "remix-1", "remix-2", "remix-3", "remix-4", "seed"
    ]);
    assert.deepEqual(assets.map((item) => item.id), originalIds);
  });
});

describe("cue-gated remix arbitration", () => {
  it("defers a new remix until its own cue authorizes it", () => {
    const queued = asset(5, "ready");
    assert.equal(getCueReadyPlaybackAsset(queued, true, null), null);
    assert.equal(getCueReadyPlaybackAsset(queued, true, "old-remix"), null);
    assert.equal(getCueReadyPlaybackAsset(queued, true, queued.id), queued);
  });

  it("does not gate playback when audio sync or auto-take is disabled", () => {
    const queued = asset(5, "ready");
    for (const [audioSyncConnected, autoTakeOnCue] of [[false, false], [false, true], [true, false]]) {
      const cueSyncActive = isCueSyncedPlaybackActive({ audioSyncConnected, autoTakeOnCue });
      assert.equal(getCueReadyPlaybackAsset(queued, cueSyncActive, null), queued);
    }
    assert.equal(getCueReadyPlaybackAsset(null, true, "remix-5"), null);
  });

  it("continues the five-video cycle while a new remix waits for a cue", () => {
    const assets = Array.from({ length: 5 }, (_, index) => asset(index));
    const queued = asset(5, "ready");
    let activeId = "seed";
    const observed: string[] = [];
    for (let boundary = 0; boundary < 15; boundary += 1) {
      const localRotationAsset = getShowPlaybackRotationAsset([...assets, queued], activeId, new Set());
      const candidate = getShowPlaybackCandidate({
        authoritativeCurrentAsset: null,
        requestedAsset: null,
        authoritativeNextAsset: getCueReadyPlaybackAsset(queued, true, null),
        localRotationAsset,
        isMonitor: false
      });
      assert.ok(candidate);
      assert.equal(candidate.source, "local-rotation");
      assert.equal(shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        localRotation: candidate.source === "local-rotation",
        audioSyncConnected: true,
        candidateAssetId: candidate.asset.id,
        authorizedAssetId: null
      }), true);
      assert.equal(shouldCommitShowPlaybackTransition({
        source: candidate.source,
        playbackMutationsEnabled: true
      }), false);
      observed.push(candidate.asset.id);
      activeId = candidate.asset.id;
    }
    const expected = ["remix-1", "remix-2", "remix-3", "remix-4", "seed"];
    assert.deepEqual(observed, [...expected, ...expected, ...expected]);
  });

  it("takes the queued remix once the matching cue arrives", () => {
    const queued = asset(5, "ready");
    const candidate = getShowPlaybackCandidate({
      authoritativeCurrentAsset: null,
      requestedAsset: null,
      authoritativeNextAsset: getCueReadyPlaybackAsset(queued, true, queued.id),
      localRotationAsset: asset(1),
      isMonitor: false
    });
    assert.equal(candidate?.source, "authoritative-next");
    assert.equal(candidate?.asset.id, queued.id);
    assert.equal(shouldHandoffPreparedPlaybackAtBoundary({
      isMonitor: false,
      localRotation: false,
      audioSyncConnected: true,
      candidateAssetId: queued.id,
      authorizedAssetId: queued.id
    }), true);
    assert.equal(shouldCommitShowPlaybackTransition({
      source: "authoritative-next", playbackMutationsEnabled: true
    }), true);
  });

  it("preserves manual-take priority without waiting for an automatic cue", () => {
    const queued = asset(5, "ready");
    const candidate = getShowPlaybackCandidate({
      authoritativeCurrentAsset: null,
      requestedAsset: queued,
      authoritativeNextAsset: getCueReadyPlaybackAsset(queued, true, null),
      localRotationAsset: asset(1),
      isMonitor: false
    });
    assert.equal(candidate?.source, "manual-request");
    assert.equal(candidate?.asset.id, queued.id);
  });

  it("lets monitor windows rotate without committing server transitions", () => {
    const candidate = getShowPlaybackCandidate({
      authoritativeCurrentAsset: null,
      requestedAsset: asset(5, "ready"),
      authoritativeNextAsset: asset(5, "ready"),
      localRotationAsset: asset(1),
      isMonitor: true
    });
    assert.equal(candidate?.source, "local-rotation");
    assert.equal(shouldCommitShowPlaybackTransition({
      source: "local-rotation", playbackMutationsEnabled: false
    }), false);
  });

  it("does not snap local rotation back to a stale authoritative current clip", () => {
    const current = asset(0);
    const queued = asset(5, "ready");
    assert.equal(getAuthoritativePlaybackCandidate(current, "remix-3", queued.id, null, current.id), null);
    assert.equal(getAuthoritativeNextPlaybackCandidate({
      currentAssetId: current.id,
      activeAssetId: "remix-3",
      nextAsset: queued,
      localRotationAuthoritativeAssetId: current.id
    }), queued);
  });
});

describe("show-screen wiring", () => {
  const source = readFileSync("components/show-screen.tsx", "utf8");

  it("uses the capped rotation helper and keeps cue detection independent", () => {
    assert.match(source, /const localRotationAsset = getShowPlaybackRotationAsset\(/);
    assert.doesNotMatch(source, /getNextPlaybackRotationAsset\([\s\S]*?playableAssets\.length/);
    assert.match(source, /const cueCandidateAsset = authoritativeNextAsset;/);
    assert.match(source, /authoritativeNextAsset: getCueReadyPlaybackAsset\(/);
  });

  it("rerenders cue authorization and consumes it only for the promoted asset", () => {
    assert.match(source, /setAuthorizedBoundaryAssetId\(cueCandidateAsset\.id\)/);
    assert.match(source, /setAuthorizedBoundaryAssetId\(selectedAssetId\)/);
    assert.match(source, /if \(authorizedBoundaryAssetIdRef\.current === transition\.assetId\) \{\s*authorizedBoundaryAssetIdRef\.current = null;\s*setAuthorizedBoundaryAssetId\(null\);/);
  });
});
