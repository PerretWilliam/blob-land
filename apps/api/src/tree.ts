interface ParentInfo {
  seed: string;
  pseudo: string;
}

interface ChildRow {
  seed: string;
  name: string | null;
  born_at: number;
  depth: number;
  parent_a: string;
  parent_b: string;
  pseudo_a: string;
  pseudo_b: string;
}

export interface FamilyTree {
  seed: string;
  /** The account's pseudo, or a child's name; null for an unknown seed. */
  name: string | null;
  parents: ParentInfo[] | null; // null if `seed` isn't a child blob
  /** Who `seed` is in an active union with, if anyone. */
  partner: ParentInfo | null;
  /** Descendants; `parents` is the pair each one was born to, so the client
   * can hang every child under the right couple. */
  children: { seed: string; name: string | null; born_at: number; depth: number; parents: [ParentInfo, ParentInfo] }[];
}

// Guards the recursion against a cycle in the data; generations stack up
// now that children pair too, but not ten deep any time soon.
const MAX_DEPTH = 10;

// A blob's display name: a child's own, or its account's pseudo.
const NAME = `COALESCE(%.name, (SELECT pseudo FROM users WHERE id = %.owner_user_id))`;
export const nameOf = (alias: string) => NAME.replaceAll("%", alias);

/** Walks the genealogy from `seed` down through `unions`/`blobs` via a
 * recursive CTE, plus the direct parents if `seed` is itself a child. */
export async function familyTree(db: D1Database, seed: string): Promise<FamilyTree> {
  const parentRow = await db
    .prepare(
      `SELECT pa.seed AS seed_a, ${nameOf("pa")} AS pseudo_a, pb.seed AS seed_b, ${nameOf("pb")} AS pseudo_b
       FROM blobs b
       JOIN unions u ON u.id = b.parent_union_id
       JOIN blobs pa ON pa.seed = u.seed_a
       JOIN blobs pb ON pb.seed = u.seed_b
       WHERE b.seed = ?`,
    )
    .bind(seed)
    .first<{ seed_a: string; pseudo_a: string; seed_b: string; pseudo_b: string }>();

  const { results } = await db
    .prepare(
      `WITH RECURSIVE tree(seed, depth) AS (
         SELECT ?, 0
         UNION ALL
         SELECT b.seed, t.depth + 1
         FROM tree t
         JOIN unions u ON u.seed_a = t.seed OR u.seed_b = t.seed
         JOIN blobs b ON b.parent_union_id = u.id
         WHERE t.depth < ${MAX_DEPTH}
       )
       SELECT b.seed, b.name, b.born_at, t.depth, pa.seed AS parent_a, pb.seed AS parent_b,
              ${nameOf("pa")} AS pseudo_a, ${nameOf("pb")} AS pseudo_b
       FROM tree t
       JOIN blobs b ON b.seed = t.seed
       JOIN unions u ON u.id = b.parent_union_id
       JOIN blobs pa ON pa.seed = u.seed_a
       JOIN blobs pb ON pb.seed = u.seed_b
       WHERE t.depth > 0 AND b.born_at <= ?2
       ORDER BY t.depth, b.born_at`,
    )
    .bind(seed, Date.now())
    .all<ChildRow>();

  const self = await db
    .prepare(
      `SELECT ${nameOf("b")} AS name FROM blobs b WHERE seed = ?`,
    )
    .bind(seed)
    .first<{ name: string | null }>();

  const partner = await db
    .prepare(
      `SELECT o.seed, ${nameOf("o")} AS pseudo
       FROM unions u
       JOIN blobs o ON o.seed = CASE WHEN u.seed_a = ?1 THEN u.seed_b ELSE u.seed_a END
       WHERE (u.seed_a = ?1 OR u.seed_b = ?1) AND u.started_at <= ?2 AND (u.ended_at IS NULL OR u.ended_at > ?2)`,
    )
    .bind(seed, Date.now())
    .first<ParentInfo>();

  return {
    seed,
    name: self?.name ?? null,
    partner: partner ?? null,
    parents: parentRow
      ? [
          { seed: parentRow.seed_a, pseudo: parentRow.pseudo_a },
          { seed: parentRow.seed_b, pseudo: parentRow.pseudo_b },
        ]
      : null,
    children: results.map(({ parent_a, parent_b, pseudo_a, pseudo_b, ...child }) => ({
      ...child,
      parents: [
        { seed: parent_a, pseudo: pseudo_a },
        { seed: parent_b, pseudo: pseudo_b },
      ],
    })),
  };
}
