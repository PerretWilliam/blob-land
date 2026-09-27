/** A source of floats in [0, 1). Every random decision in the sim takes one,
 * so tests can pin it and the app can hand it real entropy. */
export type Rng = () => number;

/** Real randomness: never the same run twice. Web Crypto exists in both the
 * desktop webview and the Worker. */
export const randomRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;

/** A fresh 32-bit seed, stored next to whatever it drives so every client
 * can replay the exact same thing (a walk, an interaction) from it. */
export const randomSeed = (rng: Rng = randomRng): number => Math.floor(rng() * 4294967296);

/** mulberry32: a replayable stream from one stored 32-bit seed. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

/** One key of `options`, each weighted by its number. Zero weights never win. */
export function weighted<T extends string>(rng: Rng, options: Partial<Record<T, number>>): T {
  const entries = Object.entries(options).filter(([, w]) => (w as number) > 0) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]![0];
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
