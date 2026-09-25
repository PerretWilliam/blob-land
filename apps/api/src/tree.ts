interface ParentInfo {
  seed: string;
  pseudo: string;
}

interface ChildRow {
  seed: string;
  born_at: number;
  depth: number;
}

export interface FamilyTree {
  seed: string;
  parents: ParentInfo[] | null; // null if `seed` isn't a child blob
  children: ChildRow[];
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
       SELECT b.seed, b.born_at, t.depth
       FROM tree t
       JOIN blobs b ON b.seed = t.seed
       WHERE t.depth > 0`,
    )
    .bind(seed)
    .all<ChildRow>();

  return {
    seed,
    parents: parentRow
      ? [
          { seed: parentRow.seed_a, pseudo: parentRow.pseudo_a },
          { seed: parentRow.seed_b, pseudo: parentRow.pseudo_b },
        ]
      : null,
    children: results,
  };
}
