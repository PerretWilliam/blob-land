import { sql } from "drizzle-orm";
import type { Db } from "./db";

type ParentInfo = {
  seed: string;
  pseudo: string;
};

type ChildRow = {
  seed: string;
  name: string | null;
  born_at: number;
  depth: number;
  parent_a: string | null;
  parent_b: string | null;
  pseudo_a: string | null;
  pseudo_b: string | null;
};

export interface FamilyTree {
  seed: string;
  /** The account's pseudo, or a child's name; null for an unknown seed. */
  name: string | null;
  parents: ParentInfo[] | null; // null if `seed` isn't a child blob
  /** Who `seed` is in an active union with, if anyone. */
  partner: ParentInfo | null;
  /** Descendants; `parents` is the couple each one was born to, so the client
   * can hang every child under the right one. */
  children: { seed: string; name: string | null; born_at: number; depth: number; parents: ParentInfo[] }[];
}

// Guards the recursion against a cycle in the data; generations stack up
// now that children pair too, but not ten deep any time soon.
const MAX_DEPTH = 10;

/**
 * Walks the genealogy from `seed` down through unions and blobs via a
 * recursive CTE, plus the direct parents if `seed` is itself a child. Plain
 * SQL: recursion is past what the ORM writes.
 *
 * An account hidden from the garden is left out wherever it would show (as
 * a parent, a partner, or the tree asked for), except to its own player,
 * `viewer`; so is a deleted one. A child of theirs shows with one parent.
 */
export async function familyTree(db: Db, seed: string, now: number, viewer: string | null): Promise<FamilyTree> {
  // Joined on this, a blob the viewer mayn't see comes out as nulls.
  const shown = (as: string) => sql`(${sql.raw(as)}.visible OR ${sql.raw(as)}.owner_user_id = ${viewer}::uuid)`;
  const [parentRows, results, selfRows, partnerRows] = await Promise.all([
    db.execute<{ seed_a: string | null; pseudo_a: string | null; seed_b: string | null; pseudo_b: string | null }>(sql`
      SELECT pa.seed AS seed_a, pa.name AS pseudo_a, pb.seed AS seed_b, pb.name AS pseudo_b
      FROM blobs b
      JOIN unions u ON u.id = b.parent_union_id
      LEFT JOIN blobs pa ON pa.seed = u.seed_a AND ${shown("pa")}
      LEFT JOIN blobs pb ON pb.seed = u.seed_b AND ${shown("pb")}
      WHERE b.seed = ${seed}`),
    db.execute<ChildRow>(sql`
      WITH RECURSIVE tree(seed, depth) AS (
        SELECT ${seed}::text, 0
        UNION ALL
        SELECT b.seed, t.depth + 1
        FROM tree t
        JOIN unions u ON u.seed_a = t.seed OR u.seed_b = t.seed
        JOIN blobs b ON b.parent_union_id = u.id
        WHERE t.depth < ${MAX_DEPTH}
      )
      SELECT b.seed, b.name, b.born_at, t.depth, pa.seed AS parent_a, pb.seed AS parent_b,
             pa.name AS pseudo_a, pb.name AS pseudo_b
      FROM tree t
      JOIN blobs b ON b.seed = t.seed
      JOIN unions u ON u.id = b.parent_union_id
      LEFT JOIN blobs pa ON pa.seed = u.seed_a AND ${shown("pa")}
      LEFT JOIN blobs pb ON pb.seed = u.seed_b AND ${shown("pb")}
      WHERE t.depth > 0 AND b.born_at <= ${now}
      ORDER BY t.depth, b.born_at`),
    db.execute<{ name: string }>(sql`SELECT b.name FROM blobs b WHERE b.seed = ${seed} AND ${shown("b")}`),
    db.execute<ParentInfo>(sql`
      SELECT o.seed, o.name AS pseudo
      FROM unions u
      JOIN blobs o ON o.seed = CASE WHEN u.seed_a = ${seed} THEN u.seed_b ELSE u.seed_a END AND ${shown("o")}
      WHERE (u.seed_a = ${seed} OR u.seed_b = ${seed}) AND u.started_at <= ${now} AND (u.ended_at IS NULL OR u.ended_at > ${now})`),
  ]);
  if (!selfRows[0]) return noTree(seed);
  const parentsOf = (a: string | null, pa: string | null, b: string | null, pb: string | null): ParentInfo[] =>
    [a && { seed: a, pseudo: pa! }, b && { seed: b, pseudo: pb! }].filter((p): p is ParentInfo => !!p);
  const parentRow = parentRows[0];
  return {
    seed,
    name: selfRows[0].name,
    partner: partnerRows[0] ?? null,
    parents: parentRow ? parentsOf(parentRow.seed_a, parentRow.pseudo_a, parentRow.seed_b, parentRow.pseudo_b) : null,
    children: [...results].map(({ parent_a, parent_b, pseudo_a, pseudo_b, ...child }) => ({
      ...child,
      parents: parentsOf(parent_a, pseudo_a, parent_b, pseudo_b),
    })),
  };
}

/** The tree of a seed no one has, or no one may see. */
const noTree = (seed: string): FamilyTree => ({ seed, name: null, partner: null, parents: null, children: [] });
