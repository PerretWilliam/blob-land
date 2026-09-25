import { hash01 } from "./hash";

/** Deterministic chance [0, 1) that two blobs present in the garden on the
 * same day fall in love. Symmetric: order of the two seeds doesn't matter. */
export function loveChance(pseudoA: string, pseudoB: string, day: string): number {
  const [x, y] = [pseudoA, pseudoB].sort();
  return hash01(`${x}|${y}|${day}|love`);
}
