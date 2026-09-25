import { hash01 } from "./hash";
import { stateAt } from "./state";

/** A point on the ground square, both axes in [0, 1]. The renderer decides
 * the projection (isometric in the desktop app). */
export interface GroundPoint {
  x: number;
  y: number;
}

/** The nest: a small square in the (0, 0) corner of the ground, on both axes.
 * Exported so the renderer draws it where blobs sleep. */
export const NEST = { min: 0.03, max: 0.13 } as const;

// One leg = walk from the previous leg's target to this leg's target, then
// idle until the leg ends. Fixed length so leg k is O(1) to find from t.
const LEG_MS = 45_000;

/** Whether a blob may stop at a point — the renderer knows the terrain (water,
 * trees…), the sim doesn't. Walking across anything is still fine. */
export type Walkable = (p: GroundPoint) => boolean;

// Rerolls before giving up on finding walkable ground (an island that is
// nearly all water): the last roll stands.
const TRIES = 12;

function legTarget(seed: string, k: number, walkable: Walkable): GroundPoint & { slow: boolean } {
  for (let n = 0; ; n++) {
    const p = rawTarget(seed, k, n ? `|${n}` : "");
    if (n >= TRIES - 1 || walkable(p)) return p;
  }
}

function rawTarget(seed: string, k: number, salt: string): GroundPoint & { slow: boolean } {
  const { activity, since } = stateAt(seed, k * LEG_MS);
  const nest = (axis: string) => NEST.min + hash01(`${seed}|nest|${axis}`) * (NEST.max - NEST.min);
  // Rest/discover spots stay out of the nest corner.
  const spot = (axis: string) => 0.25 + hash01(`${seed}|spot|${since}|${axis}${salt}`) * 0.7;
  const leg = (axis: string) => 0.03 + hash01(`${seed}|leg|${k}|${axis}${salt}`) * 0.94;
  switch (activity) {
    case "sleep":
      return { x: nest("x"), y: nest("y"), slow: false };
    // One spot per segment (keyed on `since`), so every leg of the segment
    // aims at the same point: the blob walks there slowly, then stays put.
    case "rest":
    case "discover":
      return { x: spot("x"), y: spot("y"), slow: true };
    case "explore":
      return { x: leg("x"), y: leg("y"), slow: false };
  }
}

const smoothstep = (p: number) => p * p * (3 - 2 * p);

/**
 * Where the blob stands on the ground at `t` (epoch ms). Pure in (seed, t),
 * and continuous in t — each leg starts exactly where the previous one
 * ended — so reopening the app never teleports. Every stop lands on
 * `walkable` ground; the nest is assumed to be.
 */
export function positionAt(seed: string, t: number, walkable: Walkable = () => true): GroundPoint {
  const k = Math.floor(t / LEG_MS);
  const from = legTarget(seed, k - 1, walkable);
  const to = legTarget(seed, k, walkable);
  // Fraction of the leg spent walking; the rest is a pause. Slow legs (the
  // approach to a rest/discover spot) walk the whole leg instead.
  const walk = to.slow ? 1 : 0.6 + 0.4 * hash01(`${seed}|walk|${k}`);
  const e = smoothstep(Math.min(1, (t - k * LEG_MS) / LEG_MS / walk));
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}
