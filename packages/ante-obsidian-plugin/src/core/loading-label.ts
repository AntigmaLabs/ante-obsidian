const LOADING_WORDS = [
  "thinking",
  "dreaming",
  "reasoning",
  "planning",
  "exploring",
  "crafting",
  "tracing",
  "reflecting",
] as const;

const LOADING_FRAMES = ["*", "**", "***", "**"] as const;

const hashSeed = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
};

export const getLoadingWord = (seed: string, timestamp: number = Date.now()): string => {
  const N = LOADING_WORDS.length;
  if (N <= 1) {
    return LOADING_WORDS[0] ?? "";
  }
  const cycleIndex = Math.floor(timestamp / 4000);
  const base = hashSeed(seed);
  const k = 1 + (base % (N - 1));
  const finalIndex = (base + cycleIndex * k) % N;
  return LOADING_WORDS[finalIndex] ?? LOADING_WORDS[0];
};

export const getLoadingFrame = (frameIndex: number): string => {
  const normalizedIndex =
    ((frameIndex % LOADING_FRAMES.length) + LOADING_FRAMES.length) % LOADING_FRAMES.length;
  return LOADING_FRAMES[normalizedIndex] ?? LOADING_FRAMES[0];
};

export const formatLoadingLabel = (
  seed: string,
  frameIndex: number,
  timestamp: number = Date.now(),
): string => `${getLoadingWord(seed, timestamp)} ${getLoadingFrame(frameIndex)}`;

export const __test__ = {
  LOADING_FRAMES,
  LOADING_WORDS,
  hashSeed,
};
