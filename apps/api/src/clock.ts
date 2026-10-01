import { eq } from "drizzle-orm";
import { db } from "./db";
import { config } from "./env";
import { devClock, regions } from "./schema";

/**
 * The garden's time. Real time, unless TIME_SCALE is set (local dev only, in
 * .env): then the garden runs that many times faster, so a day of blob life
 * passes in minutes. The scaled clock is anchored in a small table so it
 * keeps running across restarts, and re-anchored when the scale changes.
 * Going back to real time leaves blobs lived ahead of it: reset the local
 * database (`docker compose down -v`, then seed again).
 */
// Once the dev panel has changed the scale, the anchored clock stays in charge, even back at 1x: going back to real time would jump the garden back.
let scaledLive = false;
// A restart finds the anchored clock still in the table: the blobs lived ahead of real time stay ahead, so it keeps running (until a reset empties the table).
let probed = false;
const envScale = config.timeScale;

/** Local dev only (the /__dev/time-scale route): changes how fast the garden runs, from now on. */
export async function setTimeScale(scale: number): Promise<number> {
  await gardenNow();
  config.timeScale = scale;
  scaledLive = true;
  // Steps were scheduled a period of the old speed apart: at a faster one the garden would outrun them, so every region is due now.
  await db.update(regions).set({ nextStepAt: 0 });
  return gardenNow();
}

/** Local dev only: back to the scale .env says, on real time. */
export function resetTimeScale() {
  config.timeScale = envScale;
  scaledLive = false;
  probed = true;
}

export async function gardenNow(scale = config.timeScale): Promise<number> {
  const real = Date.now();
  if (scale === 1 && !scaledLive && !probed) {
    probed = true;
    scaledLive = (await db.select().from(devClock).where(eq(devClock.id, 1))).length > 0;
  }
  if (scale === 1 && !scaledLive) return real;
  const [row] = await db.select().from(devClock).where(eq(devClock.id, 1));
  if (row?.scale === scale) return Math.floor(row.gardenAt + (real - row.realAt) * scale);
  // First run, or a new scale: carry on from wherever the garden's clock is now.
  const at = row ? Math.floor(row.gardenAt + (real - row.realAt) * row.scale) : real;
  const anchor = { id: 1, realAt: real, gardenAt: at, scale };
  await db.insert(devClock).values(anchor).onConflictDoUpdate({ target: devClock.id, set: anchor });
  return at;
}
