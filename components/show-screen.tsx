"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  acknowledgeAuthoritativePlaybackAsset,
  decideAutomaticCueTransition,
  decideManualTakeRequest,
  getAudienceFacingRemixPrompt,
  getAuthoritativeNextPlaybackCandidate,
  getAuthoritativePlaybackCandidate,
  getIntroducedPlaybackAssetIds,
  getPlaybackAttribution,
  getShowPlaybackCandidate,
  isCueSyncedPlaybackActive,
  getRenderableVideoSlots,
  getStandbyRetryDelayMs,
  getStandbyVideoSlot,
  shouldShowPlaybackIntroduction,
  shouldAdvancePlaybackAtVideoEnd,
  shouldCommitShowPlaybackTransition,
  shouldCommitVisibleAuthoritativeNext,
  shouldHoldPlaybackForAuthoritativeCommit,
  shouldHandoffPreparedPlaybackAtBoundary,
  type ShowPlaybackCandidateSource,
  type VideoSlotIndex,
  getTypewriterChunkSize
} from "@/lib/remix-transition";
import { getAccountRemixPath } from "@/lib/remix-links";
import {
  getCueReadyPlaybackAsset,
  getShowPlaybackRotationAsset
} from "@/lib/show-playback-rotation";
import { readShowPlaybackModeMessage } from "@/lib/show-playback-mode";
import { shouldShowNextRemixProgressOverlay } from "@/lib/show-overlay-state";
import type { SessionSnapshot } from "@/lib/snapshot";
import { useAudioReactiveVisualEffect } from "@/lib/use-audio-reactive-visual-effect";
import { useSessionSnapshot } from "@/lib/use-session-snapshot";
import { useShowAudioSync } from "@/lib/use-show-audio-sync";
import { wordmarkCropLayout } from "@/lib/wordmark-layout";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  isMonitor?: boolean;
};

type QueuedTransition = {
  assetId: string;
  assetStatus: string;
  source: ShowPlaybackCandidateSource;
  nickname: string | null;
  promptText: string;
  referenceImageUrl: string | null;
  videoSlot: VideoSlotIndex;
};

type PlayableQueuedAsset = {
  id: string;
  kind: string;
  title: string;
  promptText: string;
  publicUrl: string | null;
  status: string;
  createdAt: Date;
  sourceSubmission: {
    rawText: string;
    sender: string | null;
    source: string;
    referenceImageUrl: string | null;
  } | null;
};

type VideoSlot = {
  assetId: string;
  url: string;
  nickname: string;
  promptText: string;
  showAttribution: boolean;
};

type VideoSlots = [VideoSlot | null, VideoSlot | null];

export const subtleVideoCrossfadeMilliseconds = 200;

export function canMutateShowPlayback(isMonitor: boolean) {
  return !isMonitor;
}

export function shouldAdvanceShowPlaybackAtVideoEnd(input: {
  isMonitor: boolean;
  activeSlotEnded: boolean;
  audioSyncConnected: boolean;
  nextAssetReady: boolean;
}) {
  return shouldAdvancePlaybackAtVideoEnd({
    activeSlotEnded: input.activeSlotEnded,
    audioSyncConnected: input.audioSyncConnected,
    nextAssetReady: input.nextAssetReady
  });
}

export function getVideoSlotPresentation(
  isActive: boolean,
  isRetiring = false
) {
  const isVisible = isActive || isRetiring;

  return {
    visibility: isVisible ? ("visible" as const) : ("hidden" as const),
    opacity: isVisible ? 1 : 0,
    zIndex: isActive ? 2 : 1
  };
}

export function getAvailableStandbyVideoSlot(
  activeSlot: VideoSlotIndex,
  retiringSlot: VideoSlotIndex | null
) {
  return retiringSlot === null ? getStandbyVideoSlot(activeSlot) : null;
}

export function ShowScreen({
  initialSnapshot,
  isMonitor = false
}: ShowScreenProps) {
  const snapshot = useSessionSnapshot(initialSnapshot);
  const audioSync = useShowAudioSync(initialSnapshot.session.id);
  const [monitorMode, setMonitorMode] = useState(isMonitor);
  const playbackMutationsEnabled = canMutateShowPlayback(monitorMode);
  const initialPlaybackAsset = initialSnapshot.session.playbackState?.currentAsset ?? null;
  const initialVideoSlot = createVideoSlot(initialPlaybackAsset);
  const introducedAssetIdsRef = useRef<Set<string> | null>(null);

  if (introducedAssetIdsRef.current === null) {
    introducedAssetIdsRef.current = getIntroducedPlaybackAssetIds(
      initialSnapshot.session.visualAssets,
      initialPlaybackAsset?.id
    );
  }

  const [videoSlots, setVideoSlots] = useState<VideoSlots>(() => [
    initialVideoSlot,
    null
  ]);
  const [activeVideoSlot, setActiveVideoSlot] = useState<VideoSlotIndex>(0);
  const [retiringVideoSlot, setRetiringVideoSlot] =
    useState<VideoSlotIndex | null>(null);
  const [standbyTransition, setStandbyTransition] =
    useState<QueuedTransition | null>(null);
  const [standbyRetryRevision, setStandbyRetryRevision] = useState(0);
  const [promptReveal, setPromptReveal] = useState<QueuedTransition | null>(null);
  const [promptExiting, setPromptExiting] = useState(false);
  const [requestedAssetId, setRequestedAssetId] = useState<string | null>(null);
  const [authorizedBoundaryAssetId, setAuthorizedBoundaryAssetId] =
    useState<string | null>(null);
  const [awaitingAuthoritativeCommit, setAwaitingAuthoritativeCommit] =
    useState<{
      assetId: string;
      baselineCurrentAssetId: string | null;
    } | null>(null);
  const [submissionUrl, setSubmissionUrl] = useState("");
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const visualTargetRef = useRef<HTMLDivElement>(null);
  const wordmarkTargetRef = useRef<HTMLDivElement>(null);
  const firstVideoSlotRef = useRef<HTMLVideoElement>(null);
  const secondVideoSlotRef = useRef<HTMLVideoElement>(null);
  const activeVideoSlotRef = useRef<VideoSlotIndex>(0);
  const standbyTransitionRef = useRef<QueuedTransition | null>(null);
  const standbyReadyAssetIdRef = useRef<string | null>(null);
  const handoffInFlightRef = useRef(false);
  const authorizedBoundaryAssetIdRef = useRef<string | null>(null);
  const promptRevealRef = useRef<QueuedTransition | null>(null);
  const promptExitTimerRef = useRef<number | null>(null);
  const crossfadeTimerRef = useRef<number | null>(null);
  const standbyRetryTimerRef = useRef<number | null>(null);
  const standbyPreloadAttemptsRef = useRef(0);
  const transitionRequestAbortRef = useRef<AbortController | null>(null);
  const transitionCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const showUnmountedRef = useRef(false);
  const handledCueIdRef = useRef<string | null>(null);
  const handledManualTakeIdRef = useRef<string | null>(null);
  const locallyAdvancedAssetIdRef = useRef<string | null>(null);
  const localRotationAuthoritativeAssetIdRef = useRef<string | null>(null);
  const visibleAuthoritativeCommitAssetIdRef = useRef<string | null>(null);
  const promotedPlaybackAssetIdRef = useRef<string | null>(null);
  const cancelPromotedPlaybackRef = useRef<(() => void) | null>(null);

  const session = snapshot.session;
  const playback = session.playbackState;
  const currentAsset = playback?.currentAsset ?? null;
  const nextAsset = playback?.nextAsset ?? null;
  const renderableVideoSlots = getRenderableVideoSlots(
    videoSlots,
    activeVideoSlot,
    createVideoSlot(currentAsset)
  );
  const nextRemixRender = session.renderJobs.find(
    (job) => job.status === "queued" || job.status === "in_progress"
  );
  const nextRemixProgress = normalizeShowProgress(nextRemixRender?.progress);
  const showNextRemixProgress = shouldShowNextRemixProgressOverlay(
    session.progressOverlayVisible,
    Boolean(nextRemixRender)
  );
  const activeAssetId = renderableVideoSlots[activeVideoSlot]?.assetId ?? null;
  const holdForAuthoritativeCommit =
    shouldHoldPlaybackForAuthoritativeCommit({
      awaitingAssetId: awaitingAuthoritativeCommit?.assetId,
      baselineCurrentAssetId:
        awaitingAuthoritativeCommit?.baselineCurrentAssetId,
      currentAssetId: currentAsset?.id ?? null,
      playbackMutationsEnabled
    });
  const playableAssets = session.visualAssets.filter(
    (asset): asset is PlayableQueuedAsset => Boolean(asset?.id && asset.publicUrl)
  );
  const localRotationAsset = getShowPlaybackRotationAsset(
    playableAssets,
    activeAssetId,
    introducedAssetIdsRef.current
  );
  const requestedAsset =
    requestedAssetId && requestedAssetId !== activeAssetId
      ? playableAssets.find((asset) => asset.id === requestedAssetId) ?? null
      : null;
  const authoritativeCurrentAsset = getAuthoritativePlaybackCandidate(
    currentAsset,
    activeAssetId,
    nextAsset?.id,
    locallyAdvancedAssetIdRef.current,
    localRotationAuthoritativeAssetIdRef.current
  );
  const authoritativeNextAsset = getAuthoritativeNextPlaybackCandidate({
    currentAssetId: currentAsset?.id,
    activeAssetId,
    nextAsset,
    localRotationAuthoritativeAssetId:
      localRotationAuthoritativeAssetIdRef.current
  });
  const cueSyncedPlaybackActive = isCueSyncedPlaybackActive({
    audioSyncConnected: audioSync.connected,
    autoTakeOnCue: audioSync.autoTakeOnCue
  });
  const playbackCandidate = getShowPlaybackCandidate({
    authoritativeCurrentAsset,
    requestedAsset,
    // A remix waiting for a musical cue must not occupy the standby slot
    // and block the five-video rotation. Preload it once it is authorized.
    authoritativeNextAsset: getCueReadyPlaybackAsset(
      authoritativeNextAsset,
      cueSyncedPlaybackActive,
      authorizedBoundaryAssetId
    ),
    localRotationAsset,
    isMonitor: monitorMode,
    holdForAuthoritativeCommit
  });
  const candidateAsset = playbackCandidate?.asset ?? null;
  // Listen for cues for the queued remix even while a rotation clip is next.
  const cueCandidateAsset = authoritativeNextAsset;
  useEffect(() => {
    setSubmissionUrl(new URL(getAccountRemixPath(session.userId), window.location.origin).toString());
  }, [session.userId]);

  useEffect(() => {
    if (!isMonitor) {
      return;
    }

    const handlePlaybackModeMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent
      ) {
        return;
      }

      const nextMonitorMode = readShowPlaybackModeMessage(event.data);

      if (nextMonitorMode !== null) {
        setMonitorMode(nextMonitorMode);
      }
    };

    window.addEventListener("message", handlePlaybackModeMessage);

    return () => {
      window.removeEventListener("message", handlePlaybackModeMessage);
    };
  }, [isMonitor]);

  useEffect(() => {
    if (
      locallyAdvancedAssetIdRef.current &&
      currentAsset?.id === locallyAdvancedAssetIdRef.current
    ) {
      locallyAdvancedAssetIdRef.current = null;
    }

    if (
      localRotationAuthoritativeAssetIdRef.current &&
      currentAsset?.id === activeAssetId
    ) {
      localRotationAuthoritativeAssetIdRef.current = null;
    }

    if (
      awaitingAuthoritativeCommit &&
      (currentAsset?.id ?? null) !==
        awaitingAuthoritativeCommit.baselineCurrentAssetId
    ) {
      setAwaitingAuthoritativeCommit(null);
    }
  }, [
    activeAssetId,
    awaitingAuthoritativeCommit,
    currentAsset?.id
  ]);

  useAudioReactiveVisualEffect({
    active: audioSync.connected,
    effect: audioSync.effect,
    intensity: audioSync.intensity,
    levelsRef: audioSync.levelsRef,
    targetRef: session.wordmarkAudioReactiveOnly ? wordmarkTargetRef : visualTargetRef
  });

  const getVideoElement = useCallback(
    (slot: VideoSlotIndex) =>
      slot === 0 ? firstVideoSlotRef.current : secondVideoSlotRef.current,
    []
  );

  useEffect(() => {
    const activeVideo = getVideoElement(activeVideoSlot);

    if (
      !activeVideo ||
      !activeVideo.paused ||
      activeVideo.ended ||
      promotedPlaybackAssetIdRef.current === activeAssetId
    ) {
      return;
    }

    void requestVideoPlayback(activeVideo).catch((error) => {
      console.error("[show-video] active slot could not resume", {
        assetId: activeVideo.dataset.assetId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
      setPlaybackError(
        "The current video paused unexpectedly. Refresh this show window to resume playback."
      );
    });
  }, [activeAssetId, activeVideoSlot, getVideoElement]);

  const finishPromptReveal = useCallback(() => {
    const transition = promptRevealRef.current;

    if (!transition) {
      return;
    }

    introducedAssetIdsRef.current?.add(transition.assetId);
    setPromptExiting(true);

    if (promptExitTimerRef.current !== null) {
      window.clearTimeout(promptExitTimerRef.current);
    }

    promptExitTimerRef.current = window.setTimeout(() => {
      if (promptRevealRef.current?.assetId === transition.assetId) {
        promptRevealRef.current = null;
        setPromptReveal(null);
      }

      setPromptExiting(false);
      promptExitTimerRef.current = null;
    }, 250);
  }, []);

  useEffect(() => {
    const introducedAssetIds = introducedAssetIdsRef.current;

    if (
      !introducedAssetIds ||
      !acknowledgeAuthoritativePlaybackAsset(
        currentAsset?.id,
        promptRevealRef.current?.assetId,
        introducedAssetIds
      )
    ) {
      return;
    }

    if (promptExitTimerRef.current !== null) {
      window.clearTimeout(promptExitTimerRef.current);
      promptExitTimerRef.current = null;
    }

    promptRevealRef.current = null;
    setPromptReveal(null);
    setPromptExiting(false);
  }, [currentAsset?.id]);

  useEffect(() => {
    const cue = audioSync.lastCue;

    if (
      !playbackMutationsEnabled ||
      !audioSync.connected ||
      !cue ||
      cue.id === handledCueIdRef.current
    ) {
      return;
    }

    const decision = decideAutomaticCueTransition({
      autoTakeOnCue: audioSync.autoTakeOnCue,
      nextAssetReady: Boolean(
        cueCandidateAsset?.id && cueCandidateAsset.publicUrl
      )
    });

    if (decision === "wait-for-remix") {
      return;
    }

    handledCueIdRef.current = cue.id;

    if (decision === "take-remix" && cueCandidateAsset?.id) {
      authorizedBoundaryAssetIdRef.current = cueCandidateAsset.id;
      setAuthorizedBoundaryAssetId(cueCandidateAsset.id);
    }
  }, [
    audioSync.autoTakeOnCue,
    audioSync.connected,
    audioSync.lastCue,
    cueCandidateAsset?.id,
    cueCandidateAsset?.publicUrl,
    playbackMutationsEnabled
  ]);

  useEffect(() => {
    const requestId = audioSync.manualTakeRequestId;

    if (!playbackMutationsEnabled) {
      return;
    }

    const selectedAssetId = audioSync.manualTakeAssetId ?? nextAsset?.id ?? null;
    const decision = decideManualTakeRequest({
      requestId,
      handledRequestId: handledManualTakeIdRef.current,
      selectedAssetId,
      activeAssetId
    });

    if (decision === "ignore" || decision === "wait-for-asset" || !requestId) {
      return;
    }

    handledManualTakeIdRef.current = requestId;

    if (decision === "acknowledge-active" || !selectedAssetId) {
      return;
    }

    authorizedBoundaryAssetIdRef.current = selectedAssetId;
    setAuthorizedBoundaryAssetId(selectedAssetId);
    setRequestedAssetId(selectedAssetId);
  }, [
    activeAssetId,
    audioSync.manualTakeAssetId,
    audioSync.manualTakeRequestId,
    playbackMutationsEnabled,
    nextAsset?.id
  ]);

  useEffect(() => {
    const asset = candidateAsset as PlayableQueuedAsset | null;
    const assetUrl = resolvePlaybackUrl(asset?.publicUrl ?? null);

    if (!asset?.id || !assetUrl || asset.id === activeAssetId) {
      standbyTransitionRef.current = null;
      standbyReadyAssetIdRef.current = null;
      standbyPreloadAttemptsRef.current = 0;

      if (standbyRetryTimerRef.current !== null) {
        window.clearTimeout(standbyRetryTimerRef.current);
        standbyRetryTimerRef.current = null;
      }

      setStandbyTransition(null);
      return;
    }

    const videoSlot = getAvailableStandbyVideoSlot(
      activeVideoSlotRef.current,
      retiringVideoSlot
    );

    if (videoSlot === null) {
      return;
    }

    const existingTransition = standbyTransitionRef.current;

    if (
      existingTransition?.assetId === asset.id &&
      existingTransition.videoSlot === videoSlot &&
      existingTransition.source === playbackCandidate?.source
    ) {
      return;
    }

    const transition: QueuedTransition = {
      assetId: asset.id,
      assetStatus: asset.status,
      source: playbackCandidate?.source ?? "local-rotation",
      nickname:
        asset.sourceSubmission?.source === "web"
          ? asset.sourceSubmission.sender?.trim() || null
          : null,
      promptText: getAudienceFacingRemixPrompt(
        asset.sourceSubmission?.rawText ?? asset.promptText
      ),
      referenceImageUrl: asset.sourceSubmission?.referenceImageUrl ?? null,
      videoSlot
    };
    const nextVideoSlot = createVideoSlot(asset);

    if (!nextVideoSlot) {
      return;
    }

    standbyReadyAssetIdRef.current = null;
    standbyPreloadAttemptsRef.current = 0;

    if (standbyRetryTimerRef.current !== null) {
      window.clearTimeout(standbyRetryTimerRef.current);
      standbyRetryTimerRef.current = null;
    }

    standbyTransitionRef.current = transition;
    setStandbyTransition(transition);
    setVideoSlots((current) => {
      const nextSlots: VideoSlots = [...current];
      nextSlots[videoSlot] = nextVideoSlot;
      return nextSlots;
    });

    if (promptRevealRef.current?.assetId !== transition.assetId) {
      promptRevealRef.current = null;
      setPromptReveal(null);
      setPromptExiting(false);
    }
  }, [
    activeAssetId,
    candidateAsset?.id,
    candidateAsset?.promptText,
    candidateAsset?.publicUrl,
    candidateAsset?.sourceSubmission?.rawText,
    candidateAsset?.sourceSubmission?.referenceImageUrl,
    candidateAsset?.sourceSubmission?.sender,
    candidateAsset?.sourceSubmission?.source,
    candidateAsset?.status,
    playbackCandidate?.source,
    retiringVideoSlot
  ]);

  useEffect(() => {
    if (!standbyTransition) {
      return;
    }

    const video = getVideoElement(standbyTransition.videoSlot);

    if (!video || video.dataset.assetId !== standbyTransition.assetId) {
      return;
    }

    let cancelled = false;

    void prepareVideoForStandby(video)
      .then(() => {
        if (
          !cancelled &&
          standbyTransitionRef.current?.assetId === standbyTransition.assetId &&
          video.dataset.assetId === standbyTransition.assetId
        ) {
          standbyReadyAssetIdRef.current = standbyTransition.assetId;
          standbyPreloadAttemptsRef.current = 0;

          if (
            shouldShowPlaybackIntroduction(
              {
                id: standbyTransition.assetId,
                status: standbyTransition.assetStatus
              },
              introducedAssetIdsRef.current ?? new Set()
            )
          ) {
            setPromptExiting(false);
            promptRevealRef.current = standbyTransition;
            setPromptReveal(standbyTransition);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          standbyReadyAssetIdRef.current = null;
          console.error("[show-video] standby preload failed", {
            assetId: standbyTransition.assetId,
            videoSlot: standbyTransition.videoSlot,
            error: error instanceof Error ? error.message : String(error)
          });

          standbyPreloadAttemptsRef.current += 1;
          const retryDelay = getStandbyRetryDelayMs(
            standbyPreloadAttemptsRef.current
          );

          standbyRetryTimerRef.current = window.setTimeout(() => {
            standbyRetryTimerRef.current = null;
            setStandbyRetryRevision((revision) => revision + 1);
          }, retryDelay);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    getVideoElement,
    standbyRetryRevision,
    standbyTransition,
    videoSlots
  ]);

  const commitPlaybackTransition = useCallback(
    (assetId: string) => {
      if (!playbackMutationsEnabled) {
        return;
      }

      const commit = async () => {
        let failureReason = "The server did not confirm the playback handoff.";

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (showUnmountedRef.current) {
            return;
          }

          const requestController = new AbortController();
          transitionRequestAbortRef.current = requestController;
          const requestTimeout = window.setTimeout(() => {
            requestController.abort();
          }, 8_000);

          try {
            const response = await fetch(
              `/api/sessions/${session.id}/transition`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  assetId
                }),
                signal: requestController.signal
              }
            );
            const result = (await response.json().catch(() => null)) as {
              transitioned?: boolean;
            } | null;

            if (response.ok && result?.transitioned) {
              return;
            }

            failureReason = `Playback handoff was rejected with status ${response.status}.`;

            if (response.status < 500) {
              break;
            }
          } catch (error) {
            failureReason =
              error instanceof Error ? error.message : String(error);
          } finally {
            window.clearTimeout(requestTimeout);

            if (transitionRequestAbortRef.current === requestController) {
              transitionRequestAbortRef.current = null;
            }
          }

          if (attempt < 3) {
            await waitForPlaybackRetry(attempt * 250);
          }
        }

        if (showUnmountedRef.current) {
          return;
        }

        console.error("[show-transition] server handoff could not be reconciled", {
          assetId,
          failureReason
        });
        // The display changes locally at the media boundary. If all server
        // commits fail, reload from the authoritative snapshot rather than
        // letting later rotations drift away from the generation queue.
        window.location.reload();
      };

      transitionCommitQueueRef.current = transitionCommitQueueRef.current.then(
        commit,
        commit
      );
    },
    [playbackMutationsEnabled, session.id]
  );

  useEffect(() => {
    const shouldCommitVisibleNext = shouldCommitVisibleAuthoritativeNext({
      currentAssetId: currentAsset?.id,
      activeAssetId,
      nextAssetId: nextAsset?.id,
      localRotationAuthoritativeAssetId:
        localRotationAuthoritativeAssetIdRef.current,
      playbackMutationsEnabled
    });

    if (!shouldCommitVisibleNext || !activeAssetId) {
      if (
        currentAsset?.id === activeAssetId ||
        nextAsset?.id !== activeAssetId
      ) {
        visibleAuthoritativeCommitAssetIdRef.current = null;
      }

      return;
    }

    if (visibleAuthoritativeCommitAssetIdRef.current === activeAssetId) {
      return;
    }

    visibleAuthoritativeCommitAssetIdRef.current = activeAssetId;
    locallyAdvancedAssetIdRef.current = activeAssetId;
    localRotationAuthoritativeAssetIdRef.current = null;
    standbyTransitionRef.current = null;
    standbyReadyAssetIdRef.current = null;
    setStandbyTransition(null);
    setAwaitingAuthoritativeCommit({
      assetId: activeAssetId,
      baselineCurrentAssetId: currentAsset?.id ?? null
    });
    commitPlaybackTransition(activeAssetId);
  }, [
    activeAssetId,
    commitPlaybackTransition,
    currentAsset?.id,
    nextAsset?.id,
    playbackMutationsEnabled
  ]);

  const handleVideoBoundary = useCallback(
    (videoSlot: VideoSlotIndex, outgoingVideo: HTMLVideoElement) => {
      if (
        activeVideoSlotRef.current !== videoSlot ||
        handoffInFlightRef.current
      ) {
        return;
      }

      const transition = standbyTransitionRef.current;
      const introductionPending =
        transition &&
        promptRevealRef.current?.assetId === transition.assetId;
      const boundaryAuthorized = shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: monitorMode,
        localRotation: transition?.source === "local-rotation",
        audioSyncConnected: cueSyncedPlaybackActive,
        candidateAssetId: transition?.assetId ?? null,
        authorizedAssetId:
          authoritativeCurrentAsset?.id ??
          authorizedBoundaryAssetIdRef.current
      });

      if (
        !transition ||
        standbyReadyAssetIdRef.current !== transition.assetId ||
        introductionPending ||
        !boundaryAuthorized
      ) {
        void restartVideoAtBoundary(outgoingVideo);
        return;
      }

      const incomingVideo = getVideoElement(transition.videoSlot);

      if (
        !incomingVideo ||
        incomingVideo.dataset.assetId !== transition.assetId
      ) {
        void restartVideoAtBoundary(outgoingVideo);
        return;
      }

      handoffInFlightRef.current = true;

      try {
        const shouldCommitAuthoritativePlayback =
          shouldCommitShowPlaybackTransition({
            source: transition.source,
            playbackMutationsEnabled
          });

        outgoingVideo.pause();
        introducedAssetIdsRef.current?.add(transition.assetId);
        activeVideoSlotRef.current = transition.videoSlot;
        standbyTransitionRef.current = null;
        standbyReadyAssetIdRef.current = null;
        // A cue can arrive at the same boundary as a local rotation. Only
        // consume it when its own asset is actually promoted.
        if (authorizedBoundaryAssetIdRef.current === transition.assetId) {
          authorizedBoundaryAssetIdRef.current = null;
          setAuthorizedBoundaryAssetId(null);
        }
        if (shouldCommitAuthoritativePlayback) {
          locallyAdvancedAssetIdRef.current = transition.assetId;
          localRotationAuthoritativeAssetIdRef.current = null;
          setAwaitingAuthoritativeCommit({
            assetId: transition.assetId,
            baselineCurrentAssetId: currentAsset?.id ?? null
          });
        } else if (transition.source === "local-rotation") {
          localRotationAuthoritativeAssetIdRef.current =
            currentAsset?.id ?? null;
        } else {
          localRotationAuthoritativeAssetIdRef.current = null;
        }

        promotedPlaybackAssetIdRef.current = transition.assetId;
        cancelPromotedPlaybackRef.current?.();
        if (crossfadeTimerRef.current !== null) {
          window.clearTimeout(crossfadeTimerRef.current);
        }

        setRetiringVideoSlot(videoSlot);
        setActiveVideoSlot(transition.videoSlot);
        crossfadeTimerRef.current = window.setTimeout(() => {
          setRetiringVideoSlot((current) =>
            current === videoSlot ? null : current
          );
          crossfadeTimerRef.current = null;
        }, subtleVideoCrossfadeMilliseconds);
        setStandbyTransition(null);
        setPlaybackError(null);
        setRequestedAssetId((current) =>
          current === transition.assetId ? null : current
        );

        // Let React commit the visibility/z-index swap and let Chromium paint one
        // visible frame before play(). Calling play while the slot is hidden
        // can start the wrong composited layer and leave the visible one still.
        cancelPromotedPlaybackRef.current = scheduleAfterVisiblePaint(() => {
          cancelPromotedPlaybackRef.current = null;

          if (promotedPlaybackAssetIdRef.current === transition.assetId) {
            promotedPlaybackAssetIdRef.current = null;
          }

          if (
            activeVideoSlotRef.current !== transition.videoSlot ||
            incomingVideo.dataset.assetId !== transition.assetId
          ) {
            return;
          }

          void requestVideoPlayback(incomingVideo).catch((error) => {
            console.error("[show-transition] promoted video could not start", {
              assetId: transition.assetId,
              error: error instanceof Error ? error.message : String(error)
            });

            if (
              activeVideoSlotRef.current === transition.videoSlot &&
              incomingVideo.dataset.assetId === transition.assetId
            ) {
              setPlaybackError(
                "The next remix could not start. Refresh this show window to retry it."
              );
              void restartVideoAtBoundary(incomingVideo);
            }
          });
        });

        if (shouldCommitAuthoritativePlayback) {
          commitPlaybackTransition(transition.assetId);
        }
      } catch (error) {
        incomingVideo.pause();
        void restartVideoAtBoundary(outgoingVideo);
        console.error("[show-transition] prepared boundary handoff failed", {
          assetId: transition.assetId,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        handoffInFlightRef.current = false;
      }
    },
    [
      authoritativeCurrentAsset?.id,
      commitPlaybackTransition,
      cueSyncedPlaybackActive,
      currentAsset?.id,
      getVideoElement,
      monitorMode,
      playbackMutationsEnabled
    ]
  );

  useEffect(() => {
    showUnmountedRef.current = false;

    return () => {
      showUnmountedRef.current = true;

      if (promptExitTimerRef.current !== null) {
        window.clearTimeout(promptExitTimerRef.current);
      }

      if (standbyRetryTimerRef.current !== null) {
        window.clearTimeout(standbyRetryTimerRef.current);
      }

      if (crossfadeTimerRef.current !== null) {
        window.clearTimeout(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }

      cancelPromotedPlaybackRef.current?.();
      cancelPromotedPlaybackRef.current = null;
      promotedPlaybackAssetIdRef.current = null;

      transitionRequestAbortRef.current?.abort();
      transitionRequestAbortRef.current = null;
      promptRevealRef.current = null;
      standbyTransitionRef.current = null;
    };
  }, []);

  return (
    <main className="relative min-h-screen cursor-none overflow-hidden bg-black">
      <div ref={visualTargetRef} className="absolute inset-0 overflow-hidden">
        {!renderableVideoSlots.some(Boolean) ? (
          <div className="absolute inset-0 subtle-grid bg-aurora" />
        ) : null}

        {renderableVideoSlots.map((slot, index) => {
          if (!slot) {
            return null;
          }

          const videoSlot = index as VideoSlotIndex;
          const isActive = activeVideoSlot === videoSlot;
          const isRetiring = retiringVideoSlot === videoSlot;

          return (
            <Fragment key={`persistent-video-slot-${videoSlot}`}>
              <video
                ref={videoSlot === 0 ? firstVideoSlotRef : secondVideoSlotRef}
                data-asset-id={slot.assetId}
                className="absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-200 ease-linear motion-reduce:transition-none"
                style={getVideoSlotPresentation(isActive, isRetiring)}
                src={slot.url}
                muted
                playsInline
                preload="auto"
                onEnded={(event) => {
                  handleVideoBoundary(videoSlot, event.currentTarget);
                }}
                onError={(event) => {
                  const mediaErrorCode = event.currentTarget.error?.code ?? null;

                  console.error("[show-video] media element failed", {
                    assetId: slot.assetId,
                    videoSlot,
                    mediaErrorCode
                  });

                  if (activeVideoSlotRef.current === videoSlot) {
                    setPlaybackError(
                      "The current video could not be played. Refresh this show window to retry it."
                    );
                  }
                }}
                onCanPlay={() => {
                  if (activeVideoSlotRef.current === videoSlot) {
                    setPlaybackError(null);
                  }
                }}
                onWaiting={() => {
                  if (activeVideoSlotRef.current === videoSlot) {
                    console.warn("[show-video] active slot is waiting for media", {
                      assetId: slot.assetId,
                      videoSlot
                    });
                  }
                }}
              />
              {slot.showAttribution ? (
                <aside
                  aria-hidden={!isActive}
                  data-attribution-asset-id={slot.assetId}
                  className="pointer-events-none absolute bottom-[clamp(1rem,3vw,3rem)] right-[clamp(1rem,3vw,3rem)] max-w-[min(42rem,78vw)] rounded-2xl border border-white/15 bg-black/55 px-[clamp(0.9rem,1.8vw,1.4rem)] py-[clamp(0.75rem,1.4vw,1.1rem)] text-right shadow-2xl backdrop-blur-md transition-opacity duration-100 ease-linear"
                  style={{
                    opacity: isActive ? 1 : 0,
                    zIndex: 25
                  }}
                >
                  <p className="font-mono text-[clamp(0.6rem,1.2vw,0.82rem)] font-semibold uppercase tracking-[0.28em] text-plasma">
                    {slot.nickname}
                  </p>
                  <p className="mt-2 text-[clamp(0.9rem,1.8vw,1.35rem)] font-medium leading-snug text-white">
                    {slot.promptText}
                  </p>
                </aside>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

      {playbackError ? (
        <aside
          role="alert"
          className="pointer-events-none absolute left-1/2 top-1/2 z-50 w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-ember/40 bg-black/85 p-6 text-center shadow-2xl backdrop-blur-xl"
        >
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-ember">
            Video playback failed
          </p>
          <p className="mt-3 text-base leading-7 text-white/85">{playbackError}</p>
        </aside>
      ) : null}

      <WordmarkOverlay
        targetRef={wordmarkTargetRef}
        visible={session.wordmarkOverlayVisible}
        opacity={session.wordmarkOpacity}
        size={session.wordmarkSize}
      />

      {showNextRemixProgress ? (
        <NextRemixProgressOverlay
          progress={nextRemixProgress}
          qrOverlayVisible={session.qrOverlayVisible}
        />
      ) : null}

      {promptReveal ? (
        <PromptTypewriterOverlay
          nickname={promptReveal.nickname}
          promptText={promptReveal.promptText}
          referenceImageUrl={promptReveal.referenceImageUrl}
          exiting={promptExiting}
          onComplete={finishPromptReveal}
        />
      ) : null}

      {session.qrOverlayVisible && submissionUrl ? (
        <AudienceQrOverlay submissionUrl={submissionUrl} />
      ) : null}
    </main>
  );
}

function NextRemixProgressOverlay({
  progress,
  qrOverlayVisible
}: {
  progress: number | null;
  qrOverlayVisible: boolean;
}) {
  const hasMeasuredProgress = progress !== null;

  return (
    <aside
      className={`pointer-events-none absolute left-[clamp(0.75rem,2vw,2rem)] top-[clamp(0.75rem,2vw,2rem)] z-[35] ${
        qrOverlayVisible
          ? "right-[clamp(6.75rem,15vw,12rem)]"
          : "right-[clamp(0.75rem,2vw,2rem)]"
      }`}
    >
      <div className="rounded-2xl border border-white/15 bg-black/45 px-[clamp(0.75rem,1.5vw,1.25rem)] py-[clamp(0.55rem,1.2vw,0.9rem)] shadow-2xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[clamp(0.58rem,1.2vw,0.82rem)] font-semibold uppercase tracking-[0.34em] text-white">
            DREAM SEQUENCE
          </p>
          {hasMeasuredProgress ? (
            <p className="font-mono text-[clamp(0.52rem,1vw,0.72rem)] font-semibold uppercase tracking-[0.2em] text-white/65">
              EST. {progress}%
            </p>
          ) : null}
        </div>
        <div
          className="mt-[clamp(0.45rem,0.9vw,0.7rem)] h-[clamp(0.18rem,0.45vw,0.32rem)] overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-label="Estimated next remix generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hasMeasuredProgress ? progress : undefined}
        >
          <div
            className={`h-full rounded-full bg-plasma shadow-[0_0_14px_rgba(109,240,255,0.8)] ${
              hasMeasuredProgress
                ? "transition-[width] duration-700 ease-out"
                : "w-1/3 animate-pulse"
            }`}
            style={{
              width: hasMeasuredProgress ? `${progress}%` : undefined
            }}
          />
        </div>
      </div>
    </aside>
  );
}

function WordmarkOverlay({
  targetRef,
  visible,
  opacity,
  size
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  opacity: number;
  size: number;
}) {
  return (
    <aside
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-30 grid place-items-center overflow-hidden transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        ref={targetRef}
        className="relative overflow-hidden"
        style={{
          aspectRatio: wordmarkCropLayout.aspectRatio,
          width: `min(${Math.round(78 * size * 100) / 100}vw, ${
            Math.round(115 * size * 100) / 100
          }vh)`
        }}
      >
        <Image
          src="/vivid-fever-dreams-wordmark.png"
          alt=""
          width={3522}
          height={3522}
          priority
          draggable={false}
          className="absolute h-auto max-w-none select-none"
          style={{
            left: wordmarkCropLayout.imageLeft,
            top: wordmarkCropLayout.imageTop,
            width: wordmarkCropLayout.imageWidth,
            opacity
          }}
        />
      </div>
    </aside>
  );
}

function AudienceQrOverlay({ submissionUrl }: { submissionUrl: string }) {
  return (
    <aside className="pointer-events-none absolute right-[clamp(0.75rem,1.5vw,1.5rem)] top-[clamp(0.75rem,1.5vw,1.5rem)] z-50 w-[clamp(5rem,12vw,10rem)] overflow-hidden rounded-[clamp(0.65rem,1.2vw,1rem)] bg-white p-[clamp(0.25rem,0.55vw,0.5rem)] shadow-2xl">
      <QRCodeSVG
        value={submissionUrl}
        title="QR code for the audience remix submission page"
        level="H"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#091018"
        className="h-auto w-full"
      />
      <p className="px-1 pb-[clamp(0.2rem,0.45vw,0.4rem)] text-center font-mono text-[clamp(0.48rem,0.9vw,0.72rem)] font-black uppercase leading-[1.15] tracking-[0.08em] text-[#091018]">
        SCAN ME TO REMIX VIDEO
      </p>
    </aside>
  );
}

function PromptTypewriterOverlay({
  nickname,
  promptText,
  referenceImageUrl,
  exiting,
  onComplete
}: {
  nickname: string | null;
  promptText: string;
  referenceImageUrl: string | null;
  exiting: boolean;
  onComplete: () => void;
}) {
  const [visibleCharacterCount, setVisibleCharacterCount] = useState(0);

  useEffect(() => {
    setVisibleCharacterCount(0);

    let typingTimer: number | null = null;
    let holdTimer: number | null = null;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scheduleCompletion = (delayMs: number) => {
      holdTimer = window.setTimeout(onComplete, delayMs);
    };

    if (prefersReducedMotion || promptText.length === 0) {
      setVisibleCharacterCount(promptText.length);
      scheduleCompletion(800);
    } else {
      const chunkSize = getTypewriterChunkSize(promptText.length);
      let nextCharacterCount = 0;

      const revealNextChunk = () => {
        nextCharacterCount = Math.min(promptText.length, nextCharacterCount + chunkSize);
        setVisibleCharacterCount(nextCharacterCount);

        if (nextCharacterCount === promptText.length) {
          if (typingTimer !== null) {
            window.clearInterval(typingTimer);
            typingTimer = null;
          }

          scheduleCompletion(950);
        }
      };

      typingTimer = window.setInterval(revealNextChunk, 40);
      revealNextChunk();
    }

    return () => {
      if (typingTimer !== null) {
        window.clearInterval(typingTimer);
      }

      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
      }
    };
  }, [onComplete, promptText]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-40 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.28),transparent_72%)] px-6 transition-opacity duration-500 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Incoming remix${nickname ? ` from ${nickname}` : ""}${
        referenceImageUrl ? " with an attached reference image" : ""
      }: ${promptText}`}
    >
      <div
        className={`w-full rounded-[2rem] border border-white/10 bg-black/30 p-[clamp(1rem,2.5vw,2rem)] shadow-2xl backdrop-blur-[2px] ${
          referenceImageUrl
            ? "grid max-w-6xl items-center gap-[clamp(1rem,3vw,2.5rem)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
            : "max-w-5xl"
        }`}
        aria-hidden="true"
      >
        {referenceImageUrl ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-[1.4rem] border border-white/12 bg-black/40">
            <Image
              src={referenceImageUrl}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 1024px) 88vw, 42vw"
              className="object-cover"
            />
          </div>
        ) : null}

        <div className="px-[clamp(0.25rem,1.5vw,1rem)] py-[clamp(0.25rem,1vw,0.75rem)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.38em] text-plasma sm:text-xs">
            Incoming remix
          </p>
          {nickname ? (
            <p className="mt-4 font-mono text-[clamp(0.85rem,1.8vw,1.25rem)] uppercase tracking-[0.28em] text-white/65">
              {nickname}
            </p>
          ) : null}
          <p className="mt-5 whitespace-pre-wrap break-words font-mono text-[clamp(1.25rem,3.5vw,3.35rem)] leading-[1.22] text-white">
            {promptText.slice(0, visibleCharacterCount)}
            <span className="ml-1 inline-block animate-pulse text-plasma">▋</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function normalizeShowProgress(progress: number | null | undefined) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(progress)));
}

function resolvePlaybackUrl(url: string | null) {
  if (!url) {
    return null;
  }

  if (typeof window === "undefined") {
    return url;
  }

  try {
    const resolved = new URL(url, window.location.origin);

    if (
      resolved.hostname === "localhost" &&
      resolved.pathname.startsWith("/api/assets/")
    ) {
      return `${window.location.origin}${resolved.pathname}`;
    }

    return resolved.toString();
  } catch {
    return url;
  }
}

function createVideoSlot(asset: PlayableQueuedAsset | null): VideoSlot | null {
  const assetUrl = resolvePlaybackUrl(asset?.publicUrl ?? null);

  if (!asset?.id || !assetUrl) {
    return null;
  }

  return {
    assetId: asset.id,
    url: assetUrl,
    ...getPlaybackAttribution(asset),
    showAttribution: Boolean(asset.sourceSubmission)
  };
}

async function prepareVideoForStandby(video: HTMLVideoElement) {
  video.pause();

  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForVideoEvent(video, ["loadeddata", "canplay"], 15_000);
  }

  await seekVideoToStart(video);
}

export async function requestVideoPlayback(
  video: Pick<
    HTMLVideoElement,
    "addEventListener" | "paused" | "play" | "removeEventListener"
  >
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      video.removeEventListener("playing", handlePlaying);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };
    const handlePlaying = () => finish(resolve);
    const timeout = globalThis.setTimeout(() => {
      if (!video.paused) {
        finish(resolve);
        return;
      }

      finish(() => reject(new Error("Timed out starting remix video playback.")));
    }, 2_000);

    video.addEventListener("playing", handlePlaying, {
      once: true
    });

    try {
      const playbackRequest = video.play();

      void playbackRequest.then(
        () => finish(resolve),
        (error) => finish(() => reject(error))
      );

      if (!video.paused) {
        finish(resolve);
      }
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function restartVideoAtBoundary(video: HTMLVideoElement) {
  try {
    await seekVideoToStart(video);
    await requestVideoPlayback(video);
  } catch (error) {
    console.error("[show-video] could not restart the active loop", {
      assetId: video.dataset.assetId ?? null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function waitForPlaybackRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function scheduleAfterVisiblePaint(callback: () => void) {
  let completed = false;
  let firstFrame = 0;
  let secondFrame = 0;

  const fallbackTimer = window.setTimeout(run, 250);

  function cleanup() {
    window.clearTimeout(fallbackTimer);

    if (firstFrame) {
      window.cancelAnimationFrame(firstFrame);
    }

    if (secondFrame) {
      window.cancelAnimationFrame(secondFrame);
    }
  }

  function run() {
    if (completed) {
      return;
    }

    completed = true;
    cleanup();
    callback();
  }

  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(run);
  });

  return () => {
    if (completed) {
      return;
    }

    completed = true;
    cleanup();
  };
}

function seekVideoToStart(video: HTMLVideoElement) {
  if (video.currentTime <= 0.01) {
    video.currentTime = 0;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };
    const handleSeeked = () => finish(resolve);
    const handleError = () =>
      finish(() => reject(new Error("The browser could not seek the remix video.")));
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Timed out resetting the remix video.")));
    }, 2_000);

    video.addEventListener("seeked", handleSeeked, {
      once: true
    });
    video.addEventListener("error", handleError, {
      once: true
    });
    video.currentTime = 0;
  });
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventNames: Array<"canplay" | "loadeddata">,
  timeoutMs: number
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("error", handleError);

      for (const eventName of eventNames) {
        video.removeEventListener(eventName, handleReady);
      }
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };
    const handleReady = () => finish(resolve);
    const handleError = () =>
      finish(() => reject(new Error("The browser could not decode the remix video.")));
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for a playable remix frame.")));
    }, timeoutMs);

    for (const eventName of eventNames) {
      video.addEventListener(eventName, handleReady, {
        once: true
      });
    }

    video.addEventListener("error", handleError, {
      once: true
    });
  });
}
