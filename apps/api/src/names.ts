import { pick, randomRng, type Rng } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";

export const MAX_NAME_LENGTH = 24;

/**
 * Account pseudos and children's names are one namespace, compared on
 * normalizeSeed (so "Luna" and "luna " collide). `exceptBlob` lets a child
 * keep its own name when renamed to a variant of it.
 *
 * ponytail: check-then-write, so two different writers (a sign-up and a
 * birth) can race to the same key; the UNIQUE columns only catch same-table
 * races. A shared names table with one UNIQUE key closes it if it ever shows.
 */
export async function nameTaken(db: D1Database, name: string, exceptBlob?: string): Promise<boolean> {
  const key = normalizeSeed(name);
  const hit = await db
    .prepare(
      `SELECT 1 FROM users WHERE seed = ?1
       UNION ALL
       SELECT 1 FROM blobs WHERE name_key = ?1 AND seed IS NOT ?2
       LIMIT 1`,
    )
    .bind(key, exceptBlob ?? null)
    .first();
  return hit !== null;
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
function babyName(rng: Rng): string {
  const syllables = 2 + (rng() < 0.3 ? 1 : 0);
  let name = "";
  for (let i = 0; i < syllables; i++) name += pick(rng, ONSETS) + pick(rng, VOWELS);
  name += pick(rng, ENDINGS);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The first rolled name nobody holds yet. After enough misses, numbered. */
export async function freeBabyName(db: D1Database, rng: Rng = randomRng): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = babyName(rng);
    if (!(await nameTaken(db, name))) return name;
  }
  const base = babyName(rng);
  for (let n = 2; ; n++) if (!(await nameTaken(db, `${base}${n}`))) return `${base}${n}`;
}
