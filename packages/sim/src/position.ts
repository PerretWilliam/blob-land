import type { Segment } from "./life";
import { seededRng } from "./rng";

/** A point on the ground square, both axes in [0, 1]. The renderer decides
 * the projection (isometric in the desktop app). */
export interface GroundPoint {
  x: number;
  y: number;
}

/** The nest: a small square in the (0, 0) corner of the ground, on both axes.
 * Exported so the renderer draws it where blobs sleep. */
export const NEST = { min: 0.03, max: 0.13 } as const;

/** Moves a point the sim picked onto ground the blob can stand on. The sim
 * doesn't know the terrain (water, trees…); the renderer does. */
export type Snap = (p: GroundPoint) => GroundPoint;

// One explore stop every ~45s: walk there, pause, go on.
const LEG_MS = 45_000;
// Ground units per ms when walking to a single spot (rest, meet, bed).
const STROLL = 0.02 / 1000;

const smoothstep = (p: number) => p * p * (3 - 2 * p);
const same: Snap = (p) => p;

/**
 * The walk inside one segment at `t`, as a leg: where from, where to, how far
 * along (`e`, eased, in [0, 1]). An explore is a string of stops replayed
 * from `seg.rng` (the same on every client), ending on the segment's stored
 * point; anything else is one stroll to it, then standing still.
 */
export function legIn(seg: Segment, from: GroundPoint, t: number, snap: Snap = same): { from: GroundPoint; to: GroundPoint; e: number } {
  const end = snap({ x: seg.x, y: seg.y });
  const local = Math.max(0, t - seg.start);
  const length = Math.max(1, seg.end - seg.start);
  if (seg.activity !== "explore") {
    const walk = Math.min(length, Math.hypot(end.x - from.x, end.y - from.y) / STROLL);
    return { from, to: end, e: walk <= 0 ? 1 : smoothstep(Math.min(1, local / walk)) };
  }
  const legs = Math.max(1, Math.round(length / LEG_MS));
  const legMs = length / legs;
  const k = Math.min(legs - 1, Math.floor(local / legMs));
  // Stops 0..legs-2 are random; the last is the stored end point. Each leg
  // walks for a random share of its time, then pauses.
  const rng = seededRng(seg.rng);
  let prev = from;
  for (let i = 0; ; i++) {
    const [x, y, walk] = [0.03 + rng() * 0.94, 0.03 + rng() * 0.94, 0.6 + 0.4 * rng()];
    const stop = i === legs - 1 ? end : snap({ x, y });
    if (i === k) return { from: prev, to: stop, e: smoothstep(Math.min(1, (local - k * legMs) / legMs / walk)) };
    prev = stop;
  }
}

/** The segment running at `t` (the last one begun), and where the blob stood
 * when it began. `segments` are one blob's, sorted by start. */
export function segmentAt(segments: readonly Segment[], t: number, snap: Snap = same): { seg: Segment; from: GroundPoint } | null {
  let i = segments.length - 1;
  while (i > 0 && segments[i]!.start > t) i--;
  const seg = segments[i];
  if (!seg) return null;
  const before = segments[i - 1];
  // Without the one before (the start of a fetched window), it began where it ends.
  return { seg, from: snap(before ? { x: before.x, y: before.y } : { x: seg.x, y: seg.y }) };
}

/** Where the blob stands at `t`, played back from its stored segments.
 * Continuous: every segment starts where the one before it ended. */
export function positionOn(segments: readonly Segment[], t: number, snap: Snap = same): GroundPoint {
  const at = segmentAt(segments, t, snap);
  if (!at) return { x: 0.5, y: 0.5 };
  if (t >= at.seg.end) return snap({ x: at.seg.x, y: at.seg.y });
  const { from, to, e } = legIn(at.seg, at.from, t, snap);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}
