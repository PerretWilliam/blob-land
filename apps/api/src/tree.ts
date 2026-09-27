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

// ponytail: depth cap of 10 guards against a future cycle in the data;
// today's schema can only ever produce depth 1 (children can't pair yet).
const MAX_DEPTH = 10;

/** Walks the genealogy from `seed` down through `unions`/`blobs` via a
 * recursive CTE, plus the direct parents if `seed` is itself a child. */
export async function familyTree(db: D1Database, seed: string): Promise<FamilyTree> {
  const parentRow = await db
    .prepare(
      `SELECT pa.seed AS seed_a, pa.pseudo AS pseudo_a, pb.seed AS seed_b, pb.pseudo AS pseudo_b
       FROM blobs b
       JOIN unions u ON u.id = b.parent_union_id
       JOIN users pa ON pa.id = u.user_a
       JOIN users pb ON pb.id = u.user_b
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
         JOIN users p ON p.seed = t.seed
         JOIN unions u ON u.user_a = p.id OR u.user_b = p.id
         JOIN blobs b ON b.parent_union_id = u.id
         WHERE t.depth < ${MAX_DEPTH}
       )
       SELECT b.seed, b.name, b.born_at, t.depth, pa.seed AS parent_a, pb.seed AS parent_b, pa.pseudo AS pseudo_a, pb.pseudo AS pseudo_b
       FROM tree t
       JOIN blobs b ON b.seed = t.seed
       JOIN unions u ON u.id = b.parent_union_id
       JOIN users pa ON pa.id = u.user_a
       JOIN users pb ON pb.id = u.user_b
       WHERE t.depth > 0
       ORDER BY t.depth, b.born_at`,
    )
    .bind(seed)
    .all<ChildRow>();

  const self = await db
    .prepare(
      `SELECT pseudo AS name FROM users WHERE seed = ?1
       UNION ALL
       SELECT name FROM blobs WHERE seed = ?1
       LIMIT 1`,
    )
    .bind(seed)
    .first<{ name: string | null }>();

  const partner = await db
    .prepare(
      `SELECT o.seed, o.pseudo
       FROM users me
       JOIN unions u ON u.ended_at IS NULL AND (u.user_a = me.id OR u.user_b = me.id)
       JOIN users o ON o.id = CASE WHEN u.user_a = me.id THEN u.user_b ELSE u.user_a END
       WHERE me.seed = ?`,
    )
    .bind(seed)
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
