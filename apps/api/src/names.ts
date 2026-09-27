import { pick, randomRng, type Rng } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";

export const MAX_NAME_LENGTH = 24;

/**
 * Account pseudos and children's names are one namespace, compared on
 * normalizeSeed (so "Luna" and "luna " collide), held in D1's blob directory
 * under one UNIQUE key. `exceptBlob` lets a child keep its own name when
 * renamed to a variant of it.
 */
export async function nameTaken(db: D1Database, name: string, exceptBlob?: string): Promise<boolean> {
  const hit = await db.prepare(`SELECT 1 FROM blobs WHERE name_key = ? AND seed IS NOT ?`).bind(normalizeSeed(name), exceptBlob ?? null).first();
  return hit !== null;
}

/** Whether a write failed on a UNIQUE key: the name was taken in between. */
export const isTaken = (e: unknown) => e instanceof Error && e.message.includes("UNIQUE");

/** A trimmed name, or null when it's empty, too long, or has nothing a seed can be made of. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH || !normalizeSeed(name)) return null;
  return name;
}

const ONSETS = ["b", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t", "v", "z", "ch", "fl", "pl"];
const VOWELS = ["a", "e", "i", "o", "u", "ou", "ai"];
const ENDINGS = ["", "", "n", "l", "x", "po", "bo", "lin", "mi"];

/** A soft, pronounceable name for a newborn. */
function babyName(rng: Rng): string {
  const syllables = 2 + (rng() < 0.3 ? 1 : 0);
  let name = "";
  for (let i = 0; i < syllables; i++) name += pick(rng, ONSETS) + pick(rng, VOWELS);
  name += pick(rng, ENDINGS);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Holds the first rolled name nobody has yet for a newborn, in the garden-wide
 * directory, and returns it. After enough misses, numbered.
 */
export async function reserveBabyName(db: D1Database, seed: string, region: number, bornAt: number, rng: Rng = randomRng): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = attempt < 20 ? babyName(rng) : `${babyName(rng)}${attempt}`;
    const { meta } = await db
      .prepare(`INSERT OR IGNORE INTO blobs (seed, name_key, region, born_at) VALUES (?, ?, ?, ?)`)
      .bind(seed, normalizeSeed(name), region, bornAt)
      .run();
    if (meta.changes > 0) return name;
  }
  throw new Error(`no free name for ${seed}`);
}
