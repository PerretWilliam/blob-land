/**
 * Deterministic string -> [0, 1) hashing, independent of blobatar's own
 * (private) hash: this one seeds day events, love chance and trait mixing,
 * none of which need to match blobatar's trait-position hash.
 */

// xmur3: seeds a 32-bit state from a string.
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// mulberry32: fast 32-bit PRNG, deterministic from a single integer seed.
function mulberry32(seed: number): number {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A stable float in [0, 1) for any (key) string, e.g. `"alice|2026-09-25"`. */
export function hash01(key: string): number {
  return mulberry32(xmur3(key));
}
