// Seeded randomness so every animation and scatter is repeatable.

/** mulberry32: a small, fast 32 bit generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, as an unsigned 32 bit integer. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A generator seeded from a string, such as a block id. */
export function rngFromString(text: string): () => number {
  return mulberry32(hashString(text));
}

/** A float in [min, max) drawn from `rng`. */
export function randomRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}
