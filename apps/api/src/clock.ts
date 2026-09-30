import { eq } from "drizzle-orm";
import { db } from "./db";
import { config } from "./env";
import { devClock } from "./schema";

/**
 * The garden's time. Real time, unless TIME_SCALE is set (local dev only, in
 * .env): then the garden runs that many times faster, so a day of blob life
 * passes in minutes. The scaled clock is anchored in a small table so it
 * keeps running across restarts, and re-anchored when the scale changes.
 * Going back to real time leaves blobs lived ahead of it: reset the local
 * database (`docker compose down -v`, then seed again).
 */
export async function gardenNow(scale = config.timeScale): Promise<number> {
  const real = Date.now();
  if (scale === 1) return real;
  const [row] = await db.select().from(devClock).where(eq(devClock.id, 1));
  if (row?.scale === scale) return Math.floor(row.gardenAt + (real - row.realAt) * scale);
  // First run, or a new scale: carry on from wherever the garden's clock is now.
  const at = row ? Math.floor(row.gardenAt + (real - row.realAt) * row.scale) : real;
  const anchor = { id: 1, realAt: real, gardenAt: at, scale };
  await db.insert(devClock).values(anchor).onConflictDoUpdate({ target: devClock.id, set: anchor });
  return at;
}
