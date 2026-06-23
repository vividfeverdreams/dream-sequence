export type AudioReactivePresetId =
  | "bypass"
  | "pulse"
  | "strobe"
  | "impact-shake"
  | "tilt-drift"
  | "zoom-burst"
  | "prism-split"
  | "echo-bloom"
  | "hue-drift"
  | "scanline-glitch";

export type AudioReactivePreset = {
  id: AudioReactivePresetId;
  label: string;
  shortLabel: string;
  description: string;
  audioFocus: string;
};

export type VisualSwitchMode = "manual" | "auto";

export type VisualTransitionStyle = "hard-cut" | "fade";

export type AudioReactiveSharedState = {
  presetId: AudioReactivePresetId;
  intensity: number;
  switchMode: VisualSwitchMode;
  manualTransitionStyle: VisualTransitionStyle;
  autoSensitivity: number;
};

export type AudioReactiveMetrics = {
  low: number;
  mid: number;
  high: number;
  energy: number;
  transient: number;
  beat: number;
  spectralFlux: number;
  centroid: number;
  silence: number;
};

export type AudioReactiveSongChangeEvent = {
  id: string;
  sourceLabel: string;
  transitionStyle: VisualTransitionStyle;
  confidence: number;
  reason: string;
  detectedAt: number;
};

export const AUDIO_REACTIVE_PRESETS: AudioReactivePreset[] = [
  {
    id: "bypass",
    label: "Bypass",
    shortLabel: "Bypass",
    description: "Keep the show clean and ignore the audio-reactive layer.",
    audioFocus: "none"
  },
  {
    id: "pulse",
    label: "Scale Pulse",
    shortLabel: "Pulse",
    description: "Bass makes the frame breathe and pushes brightness on impact.",
    audioFocus: "kick / bass"
  },
  {
    id: "strobe",
    label: "Beat Strobe",
    shortLabel: "Strobe",
    description: "Transient hits flash the image for aggressive drops and snares.",
    audioFocus: "snare / clap / transients"
  },
  {
    id: "impact-shake",
    label: "Impact Shake",
    shortLabel: "Shake",
    description: "Low-end punches jolt the frame horizontally and vertically.",
    audioFocus: "kick / low transients"
  },
  {
    id: "tilt-drift",
    label: "Tilt Drift",
    shortLabel: "Tilt",
    description: "Bass and mids add a subtle rock-and-roll camera tilt.",
    audioFocus: "bass / mids"
  },
  {
    id: "zoom-burst",
    label: "Zoom Burst",
    shortLabel: "Zoom",
    description: "Drops and kicks push a fast in-and-out zoom with extra contrast.",
    audioFocus: "kick / drops"
  },
  {
    id: "prism-split",
    label: "Prism Split",
    shortLabel: "Prism",
    description: "Highs and loud sections add chromatic glow and rave color bleed.",
    audioFocus: "hi-hats / highs"
  },
  {
    id: "echo-bloom",
    label: "Echo Bloom",
    shortLabel: "Echo",
    description: "Mids and sustained energy create soft ghosting and bloom.",
    audioFocus: "pads / mids / sustained energy"
  },
  {
    id: "hue-drift",
    label: "Hue Drift",
    shortLabel: "Hue",
    description: "Different bands sweep the palette while peaks intensify saturation.",
    audioFocus: "mids / highs"
  },
  {
    id: "scanline-glitch",
    label: "Scanline Glitch",
    shortLabel: "Glitch",
    description: "High-end detail and transients drive scanlines and digital tearing.",
    audioFocus: "snare / highs / noise"
  }
];

export const AUDIO_REACTIVE_PRESET_MAP = Object.fromEntries(
  AUDIO_REACTIVE_PRESETS.map((preset) => [preset.id, preset])
) as Record<AudioReactivePresetId, AudioReactivePreset>;

export const DEFAULT_AUDIO_REACTIVE_STATE: AudioReactiveSharedState = {
  presetId: "bypass",
  intensity: 0.82,
  switchMode: "manual",
  manualTransitionStyle: "fade",
  autoSensitivity: 1
};

export const DEFAULT_AUDIO_REACTIVE_METRICS: AudioReactiveMetrics = {
  low: 0,
  mid: 0,
  high: 0,
  energy: 0,
  transient: 0,
  beat: 0,
  spectralFlux: 0,
  centroid: 0,
  silence: 1
};

export function getNextAudioReactivePresetId(current: AudioReactivePresetId, direction: 1 | -1) {
  const currentIndex = AUDIO_REACTIVE_PRESETS.findIndex((preset) => preset.id === current);

  if (currentIndex === -1) {
    return DEFAULT_AUDIO_REACTIVE_STATE.presetId;
  }

  const nextIndex = (currentIndex + direction + AUDIO_REACTIVE_PRESETS.length) % AUDIO_REACTIVE_PRESETS.length;
  return AUDIO_REACTIVE_PRESETS[nextIndex]?.id ?? DEFAULT_AUDIO_REACTIVE_STATE.presetId;
}

export function isAudioReactivePresetId(value: unknown): value is AudioReactivePresetId {
  return typeof value === "string" && value in AUDIO_REACTIVE_PRESET_MAP;
}

export function isVisualSwitchMode(value: unknown): value is VisualSwitchMode {
  return value === "manual" || value === "auto";
}

export function isVisualTransitionStyle(value: unknown): value is VisualTransitionStyle {
  return value === "hard-cut" || value === "fade";
}

export function sanitizeAudioReactiveState(value: unknown): AudioReactiveSharedState {
  if (!value || typeof value !== "object") {
    return DEFAULT_AUDIO_REACTIVE_STATE;
  }

  const candidate = value as Partial<AudioReactiveSharedState>;

  return {
    presetId: isAudioReactivePresetId(candidate.presetId)
      ? candidate.presetId
      : DEFAULT_AUDIO_REACTIVE_STATE.presetId,
    intensity: clamp(typeof candidate.intensity === "number" ? candidate.intensity : DEFAULT_AUDIO_REACTIVE_STATE.intensity, 0.35, 1.6),
    switchMode: isVisualSwitchMode(candidate.switchMode)
      ? candidate.switchMode
      : DEFAULT_AUDIO_REACTIVE_STATE.switchMode,
    manualTransitionStyle: isVisualTransitionStyle(candidate.manualTransitionStyle)
      ? candidate.manualTransitionStyle
      : DEFAULT_AUDIO_REACTIVE_STATE.manualTransitionStyle,
    autoSensitivity: clamp(
      typeof candidate.autoSensitivity === "number"
        ? candidate.autoSensitivity
        : DEFAULT_AUDIO_REACTIVE_STATE.autoSensitivity,
      0.55,
      1.55
    )
  };
}

export function getAudioReactiveStorageKey(sessionId: string) {
  return `dream-sequence:audio-reactive:${sessionId}`;
}

export function getAudioReactiveDeviceStorageKey(sessionId: string) {
  return `dream-sequence:audio-reactive-device:${sessionId}`;
}

export function getAudioReactiveChannelName(sessionId: string) {
  return `dream-sequence:audio-reactive:${sessionId}`;
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}
