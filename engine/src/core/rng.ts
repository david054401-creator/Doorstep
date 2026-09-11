/**
 * Seeded deterministic RNG. Every stochastic step in the engine — grain,
 * idle-layer jitter, sampling for calibration — draws from one of these so a
 * rebuild from the same graph is byte-identical.
 */

export type Rng = {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  range(min: number, max: number): number;
  bool(p?: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  gaussian(mean?: number, stddev?: number): number;
  fork(label: string): Rng;
  readonly seed: number;
};

function hashSeed(input: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedFrom(value: string | number): number {
  return typeof value === 'number' ? value >>> 0 : hashSeed(value);
}

/** mulberry32 — small, fast, good enough statistical quality, fully portable. */
export function makeRng(seedInput: string | number): Rng {
  const seed = seedFrom(seedInput);
  let state = seed || 0x9e3779b9;
  let spare: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    seed,
    next,
    int: (lo, hi) => lo + Math.floor(next() * Math.max(0, hi - lo)),
    range: (lo, hi) => lo + next() * (hi - lo),
    bool: (p = 0.5) => next() < p,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty array');
      return items[Math.floor(next() * items.length)];
    },
    shuffle: <T,>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return out;
    },
    gaussian: (mu = 0, sigma = 1) => {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mu + sigma * v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const f = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * f;
      return mu + sigma * u * f;
    },
    fork: (label: string) => makeRng((seed ^ hashSeed(label)) >>> 0),
  };
  return rng;
}
