import type { Env } from "./env";

/**
 * The garden's time. Real time, unless TIME_SCALE is set (local dev only, in
 * .dev.vars): then the garden runs that many times faster, so a day of blob
 * life passes in minutes. The scaled clock is anchored in a small table so it
 * keeps running across worker restarts, and re-anchored when the scale changes.
 * Going back to real time leaves blobs lived ahead of it: reset the local
 * database (`pnpm db:apply`, then `pnpm seed`).
 */
export async function gardenNow(env: Env): Promise<number> {
  const real = Date.now();
  const scale = timeScale(env);
  if (scale === 1) return real;
  const db = env.DB;
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS dev_clock (id INTEGER PRIMARY KEY CHECK (id = 1), real_at INTEGER NOT NULL, garden_at INTEGER NOT NULL, scale REAL NOT NULL)`)
    .run();
  const row = await db.prepare(`SELECT real_at, garden_at, scale FROM dev_clock WHERE id = 1`).first<{ real_at: number; garden_at: number; scale: number }>();
  if (row?.scale === scale) return row.garden_at + (real - row.real_at) * scale;
  // First run, or a new scale: carry on from wherever the garden's clock is now.
  const at = row ? row.garden_at + (real - row.real_at) * row.scale : real;
  await db.prepare(`INSERT OR REPLACE INTO dev_clock (id, real_at, garden_at, scale) VALUES (1, ?, ?, ?)`).bind(real, at, scale).run();
  return at;
}

export const timeScale = (env: Env) => Math.max(1, Number(env.TIME_SCALE ?? 1) || 1);
