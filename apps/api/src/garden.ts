import { childTraits, dayKey, hash01, loveChance, type Parent } from "@blob-land/sim";

const DAY_MS = 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  pseudo: string;
  seed: string;
}

/**
 * Pairs up present (seen in the last 24h), free (no active union) users
 * whose deterministic daily roll falls under their loveChance. Concurrent
 * calls can both decide to pair the same two users; the UNIQUE(user_a,
 * user_b, started_at) and partial "one active union per member" indexes in
 * schema.sql reject the loser, so this just ignores that failure.
 */
export async function resolvePendingUnions(db: D1Database, now: number): Promise<void> {
  const day = dayKey(now);
  const cutoff = now - DAY_MS;
  const { results } = await db
    .prepare(
      `SELECT id, pseudo, seed FROM users
       WHERE last_seen_at >= ?
         AND id NOT IN (SELECT user_a FROM unions WHERE ended_at IS NULL)
         AND id NOT IN (SELECT user_b FROM unions WHERE ended_at IS NULL)`,
    )
    .bind(cutoff)
    .all<UserRow>();
  const present = results;

  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i]!;
      const b = present[j]!;
      const chance = loveChance(a.pseudo, b.pseudo, day);
      const roll = hash01(`${a.pseudo}|${b.pseudo}|${day}|pair-roll`);
      if (roll >= chance) continue;

      const [userA, userB] = a.id < b.id ? [a, b] : [b, a];
      try {
        await db
          .prepare(`INSERT INTO unions (id, user_a, user_b, started_at) VALUES (?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), userA.id, userB.id, now)
          .run();
      } catch {
        // Unique-index conflict: another concurrent request already paired
        // one of these two. Nothing to do.
      }
    }
  }
}

interface PendingUnionRow {
  id: string;
  user_a: string;
  user_b: string;
  started_at: number;
}

async function getParent(db: D1Database, userId: string): Promise<Parent> {
  const user = await db.prepare(`SELECT seed FROM users WHERE id = ?`).bind(userId).first<{ seed: string }>();
  if (!user) throw new Error(`union references missing user ${userId}`);
  // Users are always seed-only parents: only children (in `blobs`) carry
  // frozen traits, and children can't hold a union of their own yet.
  return { seed: user.seed, traits: null };
}

/** Writes the frozen child for any union whose birth delay has passed and
 * that doesn't have a child yet, and ends the union at that moment — a union
 * lasts until its child is born, not via a separate end endpoint. Idempotent:
 * guarded by child_traits IS NULL. */
export async function resolvePendingBirths(db: D1Database, now: number): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id, user_a, user_b, started_at FROM unions WHERE child_traits IS NULL`)
    .all<PendingUnionRow>();

  for (const union of results) {
    // Birth 1-7 days after the union starts, deterministic per union.
    const delay = (1 + hash01(`${union.id}|birth-delay`) * 6) * DAY_MS;
    const bornAt = union.started_at + delay;
    if (now < bornAt) continue;

    const [parentA, parentB] = await Promise.all([getParent(db, union.user_a), getParent(db, union.user_b)]);
    const childSeed = `child:${union.id}`;
    const traits = childTraits(parentA, parentB, childSeed);
    const traitsJson = JSON.stringify(traits);

    await db.batch([
      db
        .prepare(`INSERT OR IGNORE INTO blobs (seed, traits, parent_union_id, born_at) VALUES (?, ?, ?, ?)`)
        .bind(childSeed, traitsJson, union.id, bornAt),
      db
        .prepare(`UPDATE unions SET child_traits = ?, ended_at = ? WHERE id = ? AND child_traits IS NULL`)
        .bind(traitsJson, bornAt, union.id),
    ]);
  }
}
