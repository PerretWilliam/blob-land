import { MAX_NAME_LENGTH, pick, type Rng } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { blobs } from "./schema";

/**
 * Account pseudos and children's names are one namespace, compared on
 * normalizeSeed (so "Luna" and "luna " collide), held by blobs.name_key, one
 * unique key.
 */
export async function nameTaken(db: Db, name: string): Promise<boolean> {
  const hit = await db.select({ seed: blobs.seed }).from(blobs).where(eq(blobs.nameKey, normalizeSeed(name))).limit(1);
  return hit.length > 0;
}

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
export function babyName(rng: Rng): string {
  const syllables = 2 + (rng() < 0.3 ? 1 : 0);
  let name = "";
  for (let i = 0; i < syllables; i++) name += pick(rng, ONSETS) + pick(rng, VOWELS);
  name += pick(rng, ENDINGS);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
