type StoryContinuationInput = {
  recentPrompts: string[];
  continuationNumber: number;
};

const fallbackEvents = [
  "A narrow trail of light appears beside the current focal subject and leads into a newly revealed passage.",
  "A small floating visitor arrives beside the current focal subject, carrying a map that unfolds to reveal the next destination.",
  "An object already present in the scene opens to reveal a tiny landscape that grows into the space ahead.",
  "A nearby surface lifts into a floating platform, carrying the scene's focal subject onward toward a new vista.",
  "The scene's central form sends a gentle pulse toward the distance, where a previously dark beacon lights up in response.",
  "A curtain of soft mist parts ahead to reveal a bridge, and the scene's focal subject begins to cross it.",
  "A drifting ribbon curls around an object already in the scene, lifting it into the air to reveal a hidden doorway beneath.",
  "A distant silhouette approaches and offers a glowing seed, which takes root nearby and unfurls into a new shelter."
];

export function buildIdleStoryBeat(input: StoryContinuationInput) {
  const continuationNumber = Number.isFinite(input.continuationNumber)
    ? Math.max(1, Math.floor(input.continuationNumber))
    : 1;
  const startIndex = (continuationNumber - 1) % fallbackEvents.length;
  const recentText = input.recentPrompts.join(" ").toLowerCase();
  let event = fallbackEvents[startIndex];

  for (let offset = 0; offset < fallbackEvents.length; offset += 1) {
    const candidate = fallbackEvents[(startIndex + offset) % fallbackEvents.length];
    if (!recentText.includes(candidate.toLowerCase())) {
      event = candidate;
      break;
    }
  }

  return event;
}
