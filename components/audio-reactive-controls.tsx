"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIO_REACTIVE_PRESET_MAP,
  AUDIO_REACTIVE_PRESETS,
  clamp,
  DEFAULT_AUDIO_REACTIVE_METRICS,
  DEFAULT_AUDIO_REACTIVE_STATE,
  getAudioReactiveChannelName,
  getAudioReactiveDeviceStorageKey,
  getAudioReactiveStorageKey,
  getNextAudioReactivePresetId,
  sanitizeAudioReactiveState,
  type AudioReactiveMetrics,
  type AudioReactivePresetId,
  type AudioReactiveSharedState,
  type AudioReactiveSongChangeEvent,
  type VisualSwitchMode,
  type VisualTransitionStyle
} from "@/lib/audio-reactive";

type AudioInputDeviceOption = {
  deviceId: string;
  label: string;
};

type AudioInputDeviceSnapshot = {
  devices: AudioInputDeviceOption[];
  defaultDeviceLabel: string | null;
};

type BroadcastMessage =
  | {
      type: "state";
      senderId: string;
      state: AudioReactiveSharedState;
    }
  | {
      type: "metrics";
      senderId: string;
      metrics: AudioReactiveMetrics;
      sourceLabel: string;
      capturedAt: number;
    }
  | {
      type: "song-change";
      senderId: string;
      event: AudioReactiveSongChangeEvent;
    };

type CaptureStatus = "idle" | "requesting" | "live" | "error";

type AudioReactiveController = {
  devices: AudioInputDeviceOption[];
  defaultDeviceLabel: string | null;
  selectedDeviceId: string;
  captureStatus: CaptureStatus;
  captureError: string | null;
  sharedState: AudioReactiveSharedState;
  activeMetrics: AudioReactiveMetrics;
  localMetrics: AudioReactiveMetrics;
  remoteMetrics: AudioReactiveMetrics;
  localCaptureActive: boolean;
  remoteCaptureActive: boolean;
  activeSourceLabel: string | null;
  remoteSourceLabel: string | null;
  lastSongChange: AudioReactiveSongChangeEvent | null;
  setSelectedDeviceId: (deviceId: string) => void;
  refreshDevices: (requestAccess?: boolean) => Promise<void>;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  setPresetId: (presetId: AudioReactivePresetId) => void;
  cyclePreset: (direction: 1 | -1) => void;
  setIntensity: (value: number) => void;
  setSwitchMode: (mode: VisualSwitchMode) => void;
  setManualTransitionStyle: (style: VisualTransitionStyle) => void;
  setAutoSensitivity: (value: number) => void;
  markSongChange: (style?: VisualTransitionStyle, reason?: string) => void;
};

type AudioReactiveControlsPanelProps = {
  controller: AudioReactiveController;
  variant?: "dashboard" | "show";
  className?: string;
};

const ANALYSIS_INTERVAL_MS = 50;
const REMOTE_METRIC_TTL_MS = 1400;
const DEFAULT_AUDIO_INPUT_DEVICE_ID = "default";

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(windowObject: Window): AudioContextConstructor | undefined {
  const audioWindow = windowObject as Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };

  return (
    audioWindow.AudioContext ??
    audioWindow.webkitAudioContext
  );
}

function getAudioInputLabel(device: MediaDeviceInfo, index: number) {
  const label = device.label.trim();

  if (label) {
    return label;
  }

  return `Audio input ${index + 1}`;
}

function cleanDefaultAudioInputLabel(label: string | null) {
  if (!label) {
    return null;
  }

  const cleanedLabel = label.replace(/^Default\s*-\s*/i, "").trim();
  return cleanedLabel || label;
}

function buildDeviceSnapshot(availableDevices: MediaDeviceInfo[]): AudioInputDeviceSnapshot {
  const audioInputDevices = availableDevices.filter((device) => device.kind === "audioinput");
  const defaultDeviceLabel =
    cleanDefaultAudioInputLabel(
      audioInputDevices.find((device) => device.deviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID)?.label.trim() ?? null
    ) ?? null;
  const seenDeviceIds = new Set<string>();

  const devices = audioInputDevices.flatMap((device, index) => {
    if (!device.deviceId || device.deviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID || seenDeviceIds.has(device.deviceId)) {
      return [];
    }

    seenDeviceIds.add(device.deviceId);
    return [
      {
        deviceId: device.deviceId,
        label: getAudioInputLabel(device, index)
      }
    ];
  });

  return {
    devices,
    defaultDeviceLabel
  };
}

async function requestAudioInputDeviceAccess() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false
    }
  });

  stream.getTracks().forEach((track) => track.stop());
}

async function readAudioInputDeviceSnapshot(requestAccess = false): Promise<AudioInputDeviceSnapshot> {
  if (requestAccess) {
    await requestAudioInputDeviceAccess();
  }

  return buildDeviceSnapshot(await navigator.mediaDevices.enumerateDevices());
}

function getAudioCaptureErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone access is blocked. Allow microphone access for this site, then refresh inputs.";
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No browser-visible audio input was found.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The selected audio input is unavailable or already in use.";
    }

    if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
      return "That saved audio input is no longer available. Refresh inputs and choose it again.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

type SongChangeDetectorState = {
  initializedAt: number | null;
  lastEventAt: number;
  quietStartedAt: number | null;
  driftStartedAt: number | null;
  rollingProfile: AudioProfile;
};

type AudioProfile = {
  low: number;
  mid: number;
  high: number;
  centroid: number;
};

const DEFAULT_AUDIO_PROFILE: AudioProfile = {
  low: 0,
  mid: 0,
  high: 0,
  centroid: 0
};

function createDetectorState(): SongChangeDetectorState {
  return {
    initializedAt: null,
    lastEventAt: 0,
    quietStartedAt: null,
    driftStartedAt: null,
    rollingProfile: DEFAULT_AUDIO_PROFILE
  };
}

function detectSongChangeFromMetrics(
  detector: SongChangeDetectorState,
  metrics: AudioReactiveMetrics,
  now: number,
  sourceLabel: string,
  sensitivity: number
): AudioReactiveSongChangeEvent | null {
  const nextProfile = {
    low: metrics.low,
    mid: metrics.mid,
    high: metrics.high,
    centroid: metrics.centroid
  };

  if (!detector.initializedAt) {
    detector.initializedAt = now;
    detector.rollingProfile = nextProfile;
    return null;
  }

  const warmedUp = now - detector.initializedAt > 3600;
  const profileDistance = getProfileDistance(nextProfile, detector.rollingProfile);
  const adjustedSensitivity = clamp(sensitivity, 0.55, 1.55);
  const quietEnergyThreshold = 0.045 + (adjustedSensitivity - 1) * 0.014;
  const loudEnergyThreshold = 0.14 - (adjustedSensitivity - 1) * 0.035;
  const hardFluxThreshold = 0.2 / adjustedSensitivity;
  const hardProfileThreshold = 0.34 / adjustedSensitivity;
  const fadeProfileThreshold = 0.2 / adjustedSensitivity;
  const minEventGap = 6800 / adjustedSensitivity;
  const isQuiet = metrics.energy < quietEnergyThreshold && metrics.low < 0.08;
  const isLoudReturn = metrics.energy > loudEnergyThreshold || metrics.low > 0.22;
  const enoughGap = now - detector.lastEventAt > minEventGap;

  if (isQuiet) {
    detector.quietStartedAt ??= now;
    detector.driftStartedAt = null;
  } else if (detector.quietStartedAt) {
    const quietDuration = now - detector.quietStartedAt;

    if (
      warmedUp &&
      enoughGap &&
      quietDuration > 380 &&
      isLoudReturn &&
      (metrics.transient > 0.16 || metrics.spectralFlux > hardFluxThreshold)
    ) {
      return finalizeDetectedSongChange(detector, nextProfile, {
        sourceLabel,
        transitionStyle: "hard-cut",
        confidence: clamp(0.64 + quietDuration / 2400 + metrics.transient * 0.22, 0.64, 0.98),
        reason: quietDuration > 1050 ? "silence-to-new-track" : "deck-cut"
      });
    }

    detector.quietStartedAt = null;
  }

  if (
    warmedUp &&
    enoughGap &&
    metrics.energy > 0.12 &&
    profileDistance > hardProfileThreshold &&
    metrics.transient > 0.34 / adjustedSensitivity &&
    metrics.spectralFlux > 0.13 / adjustedSensitivity
  ) {
    return finalizeDetectedSongChange(detector, nextProfile, {
      sourceLabel,
      transitionStyle: "hard-cut",
      confidence: clamp(0.62 + profileDistance * 0.72 + metrics.transient * 0.2, 0.62, 0.96),
      reason: "abrupt-spectral-shift"
    });
  }

  if (
    warmedUp &&
    enoughGap &&
    metrics.energy > 0.1 &&
    profileDistance > fadeProfileThreshold &&
    metrics.spectralFlux > 0.052 / adjustedSensitivity
  ) {
    detector.driftStartedAt ??= now;

    if (now - detector.driftStartedAt > 2200) {
      return finalizeDetectedSongChange(detector, nextProfile, {
        sourceLabel,
        transitionStyle: "fade",
        confidence: clamp(0.56 + profileDistance * 0.62 + metrics.spectralFlux * 0.18, 0.56, 0.9),
        reason: "sustained-mix-shift"
      });
    }
  } else if (profileDistance < fadeProfileThreshold * 0.62 || metrics.energy < 0.08) {
    detector.driftStartedAt = null;
  }

  detector.rollingProfile = mixProfile(detector.rollingProfile, nextProfile, 0.035);
  return null;
}

function finalizeDetectedSongChange(
  detector: SongChangeDetectorState,
  nextProfile: AudioProfile,
  event: Omit<AudioReactiveSongChangeEvent, "id" | "detectedAt">
): AudioReactiveSongChangeEvent {
  const detectedAt = Date.now();
  detector.lastEventAt = detectedAt;
  detector.quietStartedAt = null;
  detector.driftStartedAt = null;
  detector.rollingProfile = nextProfile;

  return {
    ...event,
    id: `${detectedAt}:${Math.random().toString(36).slice(2)}`,
    detectedAt
  };
}

function getProfileDistance(current: AudioProfile, previous: AudioProfile) {
  return clamp(
    Math.abs(current.low - previous.low) * 0.34 +
      Math.abs(current.mid - previous.mid) * 0.3 +
      Math.abs(current.high - previous.high) * 0.24 +
      Math.abs(current.centroid - previous.centroid) * 0.3,
    0,
    1
  );
}

function mixProfile(current: AudioProfile, target: AudioProfile, amount: number): AudioProfile {
  return {
    low: mix(current.low, target.low, amount),
    mid: mix(current.mid, target.mid, amount),
    high: mix(current.high, target.high, amount),
    centroid: mix(current.centroid, target.centroid, amount)
  };
}

export function useAudioReactiveController(sessionId: string, hostLabel: string): AudioReactiveController {
  const [sharedState, setSharedState] = useState<AudioReactiveSharedState>(DEFAULT_AUDIO_REACTIVE_STATE);
  const [devices, setDevices] = useState<AudioInputDeviceOption[]>([]);
  const [defaultDeviceLabel, setDefaultDeviceLabel] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState("default");
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [localMetrics, setLocalMetrics] = useState<AudioReactiveMetrics>(DEFAULT_AUDIO_REACTIVE_METRICS);
  const [remoteMetrics, setRemoteMetrics] = useState<AudioReactiveMetrics>(DEFAULT_AUDIO_REACTIVE_METRICS);
  const [remoteSourceLabel, setRemoteSourceLabel] = useState<string | null>(null);
  const [lastRemoteMetricAt, setLastRemoteMetricAt] = useState<number | null>(null);
  const [remoteMetricClock, setRemoteMetricClock] = useState(0);
  const [lastSongChange, setLastSongChange] = useState<AudioReactiveSongChangeEvent | null>(null);
  const senderIdRef = useRef("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastPublishedAtRef = useRef(0);
  const smoothedMetricsRef = useRef<AudioReactiveMetrics>(DEFAULT_AUDIO_REACTIVE_METRICS);
  const previousEnergyRef = useRef(0);
  const previousLowRef = useRef(0);
  const previousFrameMetricsRef = useRef<AudioReactiveMetrics>(DEFAULT_AUDIO_REACTIVE_METRICS);
  const detectorRef = useRef<SongChangeDetectorState>(createDetectorState());
  const sharedStateRef = useRef<AudioReactiveSharedState>(sharedState);
  const currentSourceLabelRef = useRef("Default audio input");

  useEffect(() => {
    senderIdRef.current = `${hostLabel}:${crypto.randomUUID()}`;
  }, [hostLabel]);

  useEffect(() => {
    sharedStateRef.current = sharedState;
  }, [sharedState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const persistedState = window.localStorage.getItem(getAudioReactiveStorageKey(sessionId));
    if (persistedState) {
      try {
        setSharedState(sanitizeAudioReactiveState(JSON.parse(persistedState)));
      } catch {
        setSharedState(DEFAULT_AUDIO_REACTIVE_STATE);
      }
    }

    const persistedDeviceId = window.localStorage.getItem(getAudioReactiveDeviceStorageKey(sessionId));
    if (persistedDeviceId) {
      setSelectedDeviceIdState(persistedDeviceId);
    }

    void refreshDevices();
  }, [sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(getAudioReactiveChannelName(sessionId));
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const payload = event.data as BroadcastMessage;

      if (!payload || payload.senderId === senderIdRef.current) {
        return;
      }

      if (payload.type === "state") {
        setSharedState(sanitizeAudioReactiveState(payload.state));
        window.localStorage.setItem(
          getAudioReactiveStorageKey(sessionId),
          JSON.stringify(sanitizeAudioReactiveState(payload.state))
        );
        return;
      }

      if (payload.type === "song-change") {
        setLastSongChange(payload.event);
        return;
      }

      setRemoteMetrics(payload.metrics);
      setRemoteSourceLabel(payload.sourceLabel);
      setLastRemoteMetricAt(payload.capturedAt);
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!lastRemoteMetricAt) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRemoteMetricClock(Date.now());
    }, REMOTE_METRIC_TTL_MS + 60);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [lastRemoteMetricAt]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  async function refreshDevices(requestAccess = false) {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const deviceSnapshot = await readAudioInputDeviceSnapshot(requestAccess);
      applyDeviceSnapshot(deviceSnapshot, requestAccess);

      if (requestAccess) {
        setCaptureError(null);
      }
    } catch (error) {
      setDevices([]);
      setDefaultDeviceLabel(null);

      if (requestAccess) {
        setCaptureError(getAudioCaptureErrorMessage(error, "Could not refresh audio inputs."));
      }
    }
  }

  function applyDeviceSnapshot(deviceSnapshot: AudioInputDeviceSnapshot, resetUnavailableDevice = false) {
    setDevices(deviceSnapshot.devices);
    setDefaultDeviceLabel(deviceSnapshot.defaultDeviceLabel);

    if (!resetUnavailableDevice) {
      return;
    }

    setSelectedDeviceIdState((currentDeviceId) => {
      const currentDeviceStillAvailable =
        currentDeviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID ||
        deviceSnapshot.devices.some((device) => device.deviceId === currentDeviceId);

      if (currentDeviceStillAvailable) {
        return currentDeviceId;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(getAudioReactiveDeviceStorageKey(sessionId), DEFAULT_AUDIO_INPUT_DEVICE_ID);
      }

      return DEFAULT_AUDIO_INPUT_DEVICE_ID;
    });
  }

  function persistSharedState(nextState: AudioReactiveSharedState) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(getAudioReactiveStorageKey(sessionId), JSON.stringify(nextState));
    }
  }

  function broadcast(message: BroadcastMessage) {
    channelRef.current?.postMessage(message);
  }

  function updateSharedState(updater: (current: AudioReactiveSharedState) => AudioReactiveSharedState) {
    setSharedState((currentState) => {
      const nextState = sanitizeAudioReactiveState(updater(currentState));
      persistSharedState(nextState);
      broadcast({
        type: "state",
        senderId: senderIdRef.current,
        state: nextState
      });
      return nextState;
    });
  }

  function setPresetId(presetId: AudioReactivePresetId) {
    updateSharedState((currentState) => ({
      ...currentState,
      presetId
    }));
  }

  function cyclePreset(direction: 1 | -1) {
    updateSharedState((currentState) => ({
      ...currentState,
      presetId: getNextAudioReactivePresetId(currentState.presetId, direction)
    }));
  }

  function setIntensity(value: number) {
    updateSharedState((currentState) => ({
      ...currentState,
      intensity: clamp(value, 0.35, 1.6)
    }));
  }

  function setSwitchMode(mode: VisualSwitchMode) {
    updateSharedState((currentState) => ({
      ...currentState,
      switchMode: mode
    }));
  }

  function setManualTransitionStyle(style: VisualTransitionStyle) {
    updateSharedState((currentState) => ({
      ...currentState,
      manualTransitionStyle: style
    }));
  }

  function setAutoSensitivity(value: number) {
    updateSharedState((currentState) => ({
      ...currentState,
      autoSensitivity: clamp(value, 0.55, 1.55)
    }));
  }

  function publishSongChange(event: AudioReactiveSongChangeEvent) {
    setLastSongChange(event);
    broadcast({
      type: "song-change",
      senderId: senderIdRef.current,
      event
    });
  }

  function markSongChange(style: VisualTransitionStyle = sharedState.manualTransitionStyle, reason = "manual-mark") {
    publishSongChange({
      id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      sourceLabel: currentSourceLabelRef.current,
      transitionStyle: style,
      confidence: 1,
      reason,
      detectedAt: Date.now()
    });
  }

  function setSelectedDeviceId(deviceId: string) {
    setSelectedDeviceIdState(deviceId);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(getAudioReactiveDeviceStorageKey(sessionId), deviceId);
    }
  }

  function stopCapture() {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    currentSourceLabelRef.current = "Default audio input";
    smoothedMetricsRef.current = DEFAULT_AUDIO_REACTIVE_METRICS;
    previousEnergyRef.current = 0;
    previousLowRef.current = 0;
    previousFrameMetricsRef.current = DEFAULT_AUDIO_REACTIVE_METRICS;
    detectorRef.current = createDetectorState();
    setLocalMetrics(DEFAULT_AUDIO_REACTIVE_METRICS);
    setCaptureStatus((currentStatus) => (currentStatus === "error" ? "error" : "idle"));
  }

  async function startCapture() {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCaptureStatus("error");
      setCaptureError("This browser does not expose audio input capture.");
      return;
    }

    const AudioContextClass = getAudioContextConstructor(window);
    if (!AudioContextClass) {
      setCaptureStatus("error");
      setCaptureError("This browser does not expose Web Audio analysis.");
      return;
    }

    stopCapture();
    setCaptureError(null);
    setCaptureStatus("requesting");

    try {
      const constraints: MediaStreamConstraints = {
        audio:
          selectedDeviceId && selectedDeviceId !== DEFAULT_AUDIO_INPUT_DEVICE_ID
            ? {
                deviceId: {
                  exact: selectedDeviceId
                },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
              }
            : {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
              }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      let refreshedDeviceSnapshot: AudioInputDeviceSnapshot | null = null;
      try {
        refreshedDeviceSnapshot = await readAudioInputDeviceSnapshot();
        applyDeviceSnapshot(refreshedDeviceSnapshot, true);
      } catch {
        refreshedDeviceSnapshot = null;
      }

      const activeTrack = stream.getAudioTracks()[0] ?? null;
      const activeTrackDeviceId = activeTrack?.getSettings().deviceId;
      const refreshedDevices = refreshedDeviceSnapshot?.devices ?? devices;
      const chosenDevice = refreshedDevices.find((device) => device.deviceId === selectedDeviceId);
      const activeTrackDevice = refreshedDevices.find((device) => device.deviceId === activeTrackDeviceId);
      const liveDefaultDeviceLabel = refreshedDeviceSnapshot?.defaultDeviceLabel ?? defaultDeviceLabel;
      currentSourceLabelRef.current =
        activeTrack?.label.trim() ||
        activeTrackDevice?.label ||
        chosenDevice?.label ||
        (selectedDeviceId === DEFAULT_AUDIO_INPUT_DEVICE_ID && liveDefaultDeviceLabel
          ? `Default (${liveDefaultDeviceLabel})`
          : "Default audio input");

      setCaptureStatus("live");

      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      const timeDomainData = new Uint8Array(analyser.fftSize);

      const analyseFrame = (frameTime: number) => {
        const liveAnalyser = analyserRef.current;
        const liveContext = audioContextRef.current;

        if (!liveAnalyser || !liveContext) {
          return;
        }

        animationFrameRef.current = window.requestAnimationFrame(analyseFrame);

        if (frameTime - lastPublishedAtRef.current < ANALYSIS_INTERVAL_MS) {
          return;
        }

        lastPublishedAtRef.current = frameTime;

        liveAnalyser.getByteFrequencyData(frequencyData);
        liveAnalyser.getByteTimeDomainData(timeDomainData);

        const low = computeBandLevel(frequencyData, liveContext.sampleRate, 24, 160);
        const mid = computeBandLevel(frequencyData, liveContext.sampleRate, 160, 2000);
        const high = computeBandLevel(frequencyData, liveContext.sampleRate, 2000, 9000);
        const centroid = computeSpectralCentroid(frequencyData, liveContext.sampleRate, 24, 9000);
        const energy = computeRmsLevel(timeDomainData);
        const transient = clamp((energy - previousEnergyRef.current) * 3.8 + (low - previousLowRef.current) * 2.6, 0, 1);
        const beat = clamp(low * 0.82 + transient * 0.9, 0, 1);
        const spectralFlux = clamp(
          Math.abs(low - previousFrameMetricsRef.current.low) * 0.28 +
            Math.abs(mid - previousFrameMetricsRef.current.mid) * 0.24 +
            Math.abs(high - previousFrameMetricsRef.current.high) * 0.22 +
            Math.abs(centroid - previousFrameMetricsRef.current.centroid) * 0.34 +
            transient * 0.12,
          0,
          1
        );

        previousEnergyRef.current = mix(previousEnergyRef.current, energy, 0.4);
        previousLowRef.current = mix(previousLowRef.current, low, 0.35);
        previousFrameMetricsRef.current = {
          low,
          mid,
          high,
          energy,
          transient,
          beat,
          spectralFlux,
          centroid,
          silence: clamp((0.16 - energy) / 0.16, 0, 1)
        };

        smoothedMetricsRef.current = {
          low: mix(smoothedMetricsRef.current.low, low, 0.32),
          mid: mix(smoothedMetricsRef.current.mid, mid, 0.26),
          high: mix(smoothedMetricsRef.current.high, high, 0.24),
          energy: mix(smoothedMetricsRef.current.energy, energy, 0.28),
          transient: mix(smoothedMetricsRef.current.transient, transient, 0.44),
          beat: mix(smoothedMetricsRef.current.beat, beat, 0.42),
          spectralFlux: mix(smoothedMetricsRef.current.spectralFlux, spectralFlux, 0.36),
          centroid: mix(smoothedMetricsRef.current.centroid, centroid, 0.22),
          silence: mix(smoothedMetricsRef.current.silence, clamp((0.16 - energy) / 0.16, 0, 1), 0.34)
        };

        const nextMetrics = {
          low: clamp(smoothedMetricsRef.current.low),
          mid: clamp(smoothedMetricsRef.current.mid),
          high: clamp(smoothedMetricsRef.current.high),
          energy: clamp(smoothedMetricsRef.current.energy),
          transient: clamp(smoothedMetricsRef.current.transient),
          beat: clamp(smoothedMetricsRef.current.beat),
          spectralFlux: clamp(smoothedMetricsRef.current.spectralFlux),
          centroid: clamp(smoothedMetricsRef.current.centroid),
          silence: clamp(smoothedMetricsRef.current.silence)
        };

        const detectedSongChange = detectSongChangeFromMetrics(
          detectorRef.current,
          nextMetrics,
          Date.now(),
          currentSourceLabelRef.current,
          sharedStateRef.current.autoSensitivity
        );

        if (detectedSongChange) {
          publishSongChange(detectedSongChange);
        }

        setLocalMetrics(nextMetrics);
        broadcast({
          type: "metrics",
          senderId: senderIdRef.current,
          metrics: nextMetrics,
          sourceLabel: currentSourceLabelRef.current,
          capturedAt: Date.now()
        });
      };

      animationFrameRef.current = window.requestAnimationFrame(analyseFrame);
    } catch (error) {
      stopCapture();
      setCaptureStatus("error");
      setCaptureError(getAudioCaptureErrorMessage(error, "Could not access that audio input."));
    }
  }

  const remoteCaptureActive = useMemo(() => {
    if (!lastRemoteMetricAt) {
      return false;
    }

    return Date.now() - lastRemoteMetricAt < REMOTE_METRIC_TTL_MS;
  }, [lastRemoteMetricAt, remoteMetricClock]);

  const localCaptureActive = captureStatus === "live";
  const activeMetrics = localCaptureActive ? localMetrics : remoteCaptureActive ? remoteMetrics : DEFAULT_AUDIO_REACTIVE_METRICS;
  const activeSourceLabel = localCaptureActive
    ? currentSourceLabelRef.current
    : remoteCaptureActive
      ? remoteSourceLabel
      : null;

  return {
    devices,
    defaultDeviceLabel,
    selectedDeviceId,
    captureStatus,
    captureError,
    sharedState,
    activeMetrics,
    localMetrics,
    remoteMetrics,
    localCaptureActive,
    remoteCaptureActive,
    activeSourceLabel,
    remoteSourceLabel,
    lastSongChange,
    setSelectedDeviceId,
    refreshDevices,
    startCapture,
    stopCapture,
    setPresetId,
    cyclePreset,
    setIntensity,
    setSwitchMode,
    setManualTransitionStyle,
    setAutoSensitivity,
    markSongChange
  };
}

export function AudioReactiveControlsPanel({
  controller,
  variant = "dashboard",
  className
}: AudioReactiveControlsPanelProps) {
  const activePreset = AUDIO_REACTIVE_PRESET_MAP[controller.sharedState.presetId];
  const compact = variant === "show";
  const activeStatusLabel = controller.localCaptureActive
    ? `Driving from ${controller.activeSourceLabel ?? "audio input"}`
    : controller.remoteCaptureActive
      ? `Following ${controller.activeSourceLabel ?? "another show view"}`
      : "No live audio feed yet";
  const panelClassName = compact
    ? "rounded-lg border border-[#3a3d3f] bg-[#181a1d]/88 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.34)] backdrop-blur-xl"
    : "panel p-5";
  const lastSongChangeLabel = controller.lastSongChange
    ? `${controller.lastSongChange.transitionStyle === "hard-cut" ? "cut" : "fade"} · ${Math.round(controller.lastSongChange.confidence * 100)}% · ${new Date(controller.lastSongChange.detectedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      })}`
    : "no change marked";

  return (
    <div className={className}>
      <div className={panelClassName}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#9ca3af]">Deck Audio / Visual Switch</p>
            <h2 className={compact ? "mt-3 text-lg font-semibold text-white" : "mt-3 text-2xl font-semibold text-white"}>
              {activePreset.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#c9c7bd]">{activePreset.description}</p>
          </div>

          <div className="rounded-md border border-[#3a3d3f] bg-[#202225] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[#baff39]">
            {activeStatusLabel}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <label className="min-w-[14rem] flex-1 rounded-md border border-[#34383c] bg-[#111315] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">Rekordbox / DJ Input</span>
            <select
              value={controller.selectedDeviceId}
              onChange={(event) => controller.setSelectedDeviceId(event.target.value)}
              className="audio-reactive-select mt-3 w-full rounded-md border border-[#42464a] bg-[#202225] px-3 py-2 text-sm text-white outline-none transition focus:border-[#baff39]"
            >
              <option value={DEFAULT_AUDIO_INPUT_DEVICE_ID} className="bg-[#202225] text-white">
                {controller.defaultDeviceLabel ? `Default (${controller.defaultDeviceLabel})` : "Default audio input"}
              </option>
              {controller.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId} className="bg-[#202225] text-white">
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => void controller.refreshDevices(true)}
            className="whitespace-nowrap rounded-md border border-[#42464a] bg-[#232529] px-4 py-3 text-sm text-[#e5e1d8] transition hover:border-[#baff39]"
          >
            Refresh Inputs
          </button>

          {controller.localCaptureActive ? (
            <button
              onClick={() => controller.stopCapture()}
              className="whitespace-nowrap rounded-md bg-[#ff764d] px-4 py-3 text-sm font-semibold text-[#151515] transition hover:brightness-110"
            >
              Stop Audio
            </button>
          ) : (
            <button
              onClick={() => void controller.startCapture()}
              disabled={controller.captureStatus === "requesting"}
              className="whitespace-nowrap rounded-md bg-[#baff39] px-4 py-3 text-sm font-semibold text-[#151515] transition hover:brightness-110 disabled:cursor-progress disabled:opacity-70"
            >
              {controller.captureStatus === "requesting" ? "Connecting..." : "Start Audio Input"}
            </button>
          )}
        </div>

        {controller.captureError ? (
          <p className="mt-4 rounded-md border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {controller.captureError}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-md border border-[#34383c] bg-[#111315] p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">Visual Change Mode</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["manual", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => controller.setSwitchMode(mode)}
                  className={`rounded-md border px-3 py-2 text-sm font-semibold uppercase tracking-[0.08em] transition ${
                    controller.sharedState.switchMode === mode
                      ? "border-[#baff39] bg-[#baff39] text-[#151515]"
                      : "border-[#42464a] bg-[#232529] text-[#e5e1d8] hover:border-[#baff39]"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#aaa79f]">
              {controller.sharedState.switchMode === "auto"
                ? "Deck-change detector is armed from the selected Rekordbox/DJ audio feed."
                : "Queued visuals wait for a manual cut or fade."}
            </p>
          </div>

          <div className="rounded-md border border-[#34383c] bg-[#111315] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">Transition Response</p>
                <p className="mt-2 text-sm text-[#c9c7bd]">Last detector event: {lastSongChangeLabel}</p>
              </div>
              <button
                onClick={() => controller.markSongChange(controller.sharedState.manualTransitionStyle)}
                className="rounded-md border border-[#42464a] bg-[#232529] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#e5e1d8] transition hover:border-[#baff39]"
              >
                Mark Change
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["hard-cut", "fade"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => controller.setManualTransitionStyle(style)}
                  className={`rounded-md border px-3 py-2 text-sm font-semibold uppercase tracking-[0.08em] transition ${
                    controller.sharedState.manualTransitionStyle === style
                      ? "border-[#ff764d] bg-[#ff764d] text-[#151515]"
                      : "border-[#42464a] bg-[#232529] text-[#e5e1d8] hover:border-[#ff764d]"
                  }`}
                >
                  {style === "hard-cut" ? "Hard Cut" : "Fade"}
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">
                <span>Auto Sensitivity</span>
                <span>{controller.sharedState.autoSensitivity.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min="0.55"
                max="1.55"
                step="0.01"
                value={controller.sharedState.autoSensitivity}
                onChange={(event) => controller.setAutoSensitivity(Number(event.target.value))}
                className="mt-3 h-2 w-full cursor-pointer accent-[#baff39]"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[auto_1fr_auto]">
          <button
            onClick={() => controller.cyclePreset(-1)}
            className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-3 text-sm text-[#e5e1d8] transition hover:border-[#00a7e1]"
          >
            Previous FX
          </button>

          <label className="rounded-md border border-[#34383c] bg-[#111315] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">Effect Preset</span>
            <select
              value={controller.sharedState.presetId}
              onChange={(event) => controller.setPresetId(event.target.value as AudioReactivePresetId)}
              className="audio-reactive-select mt-3 w-full rounded-md border border-[#42464a] bg-[#202225] px-3 py-2 text-sm text-white outline-none transition focus:border-[#00a7e1]"
            >
              {AUDIO_REACTIVE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id} className="bg-[#202225] text-white">
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => controller.cyclePreset(1)}
            className="rounded-md border border-[#42464a] bg-[#232529] px-4 py-3 text-sm text-[#e5e1d8] transition hover:border-[#00a7e1]"
          >
            Next FX
          </button>
        </div>

        <div className="mt-5 rounded-md border border-[#34383c] bg-[#111315] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">Intensity</p>
              <p className="mt-2 text-sm text-[#c9c7bd]">
                Audio focus: <span className="text-white">{activePreset.audioFocus}</span>
              </p>
            </div>
            <p className="text-sm font-semibold text-white">{controller.sharedState.intensity.toFixed(2)}x</p>
          </div>
          <input
            type="range"
            min="0.35"
            max="1.6"
            step="0.01"
            value={controller.sharedState.intensity}
            onChange={(event) => controller.setIntensity(Number(event.target.value))}
            className="mt-4 h-2 w-full cursor-pointer accent-[#00a7e1]"
          />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <AudioMeterCard
            label="Kick / Bass"
            value={controller.activeMetrics.low}
            accentClassName="from-[#00a7e1] to-[#8edcff]"
          />
          <AudioMeterCard
            label="Mids / Body"
            value={controller.activeMetrics.mid}
            accentClassName="from-[#baff39] to-[#d8ff7a]"
          />
          <AudioMeterCard
            label="High / Spark"
            value={controller.activeMetrics.high}
            accentClassName="from-[#c792ea] to-[#f0b6ff]"
          />
          <AudioMeterCard
            label="Transient / Hit"
            value={Math.max(controller.activeMetrics.transient, controller.activeMetrics.beat)}
            accentClassName="from-[#ff764d] to-[#ffb199]"
          />
        </div>

        <p className="mt-4 text-sm leading-6 text-[#aaa79f]">
          Rekordbox works through a browser-visible deck feed: line input, interface loopback, BlackHole, or Loopback. Show shortcuts: `[` / `]` cycle FX, `\\` bypasses FX, `A` toggles audio, and `N` switches the queued visual.
        </p>
      </div>
    </div>
  );
}

function AudioMeterCard({
  label,
  value,
  accentClassName
}: {
  label: string;
  value: number;
  accentClassName: string;
}) {
  return (
    <div className="rounded-md border border-[#34383c] bg-[#111315] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8f9499]">{label}</p>
        <p className="text-xs font-semibold text-[#e5e1d8]">{Math.round(value * 100)}%</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-sm bg-[#272b2f]">
        <div
          className={`h-full rounded-sm bg-gradient-to-r ${accentClassName} transition-[width] duration-75`}
          style={{
            width: `${Math.max(4, value * 100)}%`
          }}
        />
      </div>
    </div>
  );
}

function computeBandLevel(
  frequencyData: Uint8Array,
  sampleRate: number,
  minFrequency: number,
  maxFrequency: number
) {
  if (frequencyData.length === 0) {
    return 0;
  }

  const nyquist = sampleRate / 2;
  const startIndex = Math.max(0, Math.floor((minFrequency / nyquist) * frequencyData.length));
  const endIndex = Math.min(frequencyData.length - 1, Math.ceil((maxFrequency / nyquist) * frequencyData.length));

  if (endIndex <= startIndex) {
    return 0;
  }

  let sum = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    sum += frequencyData[index] ?? 0;
  }

  const average = sum / (endIndex - startIndex + 1);
  return clamp(Math.pow(average / 255, 0.82) * 1.25, 0, 1);
}

function computeSpectralCentroid(
  frequencyData: Uint8Array,
  sampleRate: number,
  minFrequency: number,
  maxFrequency: number
) {
  if (frequencyData.length === 0) {
    return 0;
  }

  const nyquist = sampleRate / 2;
  const startIndex = Math.max(0, Math.floor((minFrequency / nyquist) * frequencyData.length));
  const endIndex = Math.min(frequencyData.length - 1, Math.ceil((maxFrequency / nyquist) * frequencyData.length));

  if (endIndex <= startIndex) {
    return 0;
  }

  let weightedSum = 0;
  let magnitudeSum = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const magnitude = frequencyData[index] ?? 0;
    const normalizedFrequency = index / frequencyData.length;
    weightedSum += normalizedFrequency * magnitude;
    magnitudeSum += magnitude;
  }

  if (magnitudeSum <= 0) {
    return 0;
  }

  return clamp(weightedSum / magnitudeSum, 0, 1);
}

function computeRmsLevel(timeDomainData: Uint8Array) {
  if (timeDomainData.length === 0) {
    return 0;
  }

  let sum = 0;

  for (const sample of timeDomainData) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / timeDomainData.length);
  return clamp(rms * 2.8, 0, 1);
}

function mix(current: number, target: number, amount: number) {
  return current + (target - current) * amount;
}
