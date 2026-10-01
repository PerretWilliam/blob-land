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

/*
 * The public garden's island side, in cells, for a region of `blobs` blobs.
 * The server says it (every client then draws the same island), and it grows
 * in steps of 8 so the map only changes now and then.
 */
export const MIN_GARDEN = 24;
export const MAX_GARDEN = 128;
export function gardenSize(blobs: number): number {
  const side = Math.ceil((6 * Math.sqrt(Math.max(1, blobs))) / 8) * 8;
  return Math.min(MAX_GARDEN, Math.max(MIN_GARDEN, side));
}
/** New accounts join the first region with fewer blobs than this: about
 * when its island reaches MAX_GARDEN. Children still go on being born into it. */
export const REGION_CAP = 450;

/** Moves a point the sim picked onto ground the blob can stand on. The sim
 * doesn't know the terrain (water, trees…); the renderer does. An explore's
 * stop also gets the point it wanders off from, and gives that point back if
 * it isn't an easy walk to the stop. */
export type Snap = (p: GroundPoint, from?: GroundPoint) => GroundPoint;

// One explore stop every ~45s: walk there, pause, go on.
const LEG_MS = 45_000;
// Ground units per ms when walking to a single spot (rest, meet, bed).
const STROLL = 0.02 / 1000;
// To a meeting, blobs hurry the more the farther it is: they aim to be there
// in HURRY_MS, but walk no slower than a stroll nor faster than HURRY_MAX strolls.
const HURRY_MS = 45_000;
const HURRY_MAX = 5;

/** The waypoints of a walk from one point to another, ends included: it goes
 * round lakes and cliffs, so it's longer than the straight line. A straight line by default. */
export type Route = (a: GroundPoint, b: GroundPoint) => GroundPoint[];
const straight: Route = (a, b) => [a, b];

const smoothstep = (p: number) => p * p * (3 - 2 * p);
const same: Snap = (p) => p;

/** The length of a walk along its waypoints. */
export function pathLength(path: readonly GroundPoint[]): number {
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y);
  return length;
}

/** How far along a walk a blob has got at progress `e` in [0, 1]: arc-length
 * along the route, not a straight-line lerp, so a walk bends around cliffs and
 * water instead of cutting through them. */
export function alongPath(path: readonly GroundPoint[], e: number): GroundPoint {
  if (path.length < 2) return path[0] ?? { x: 0.5, y: 0.5 };
  const total = pathLength(path);
  if (total === 0) return path[path.length - 1]!;
  let left = e * total;
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1]!, path[k]!];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len || k === path.length - 1) {
      const f = len === 0 ? 0 : Math.min(1, left / len);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= len;
  }
  return path[path.length - 1]!;
}

/**
 * The walk inside one segment at `t`, as a leg: where from, where to, how far
 * along (`e`, eased, in [0, 1]). An explore is a string of stops replayed
 * from `seg.rng` (the same on every client), ending on the segment's stored
 * point; anything else is one stroll to it, then standing still.
 *
 * `zoom` is how many times bigger the ground is than a small island's: the
 * stroll slows by as much (so blobs keep their pace across the tiles) and
 * explore stops stay that much nearer each other instead of criss-crossing
 * the whole map.
 */
export function legIn(seg: Segment, from: GroundPoint, t: number, snap: Snap = same, zoom = 1, route: Route = straight): { from: GroundPoint; to: GroundPoint; e: number } {
  const end = snap({ x: seg.x, y: seg.y });
  const local = Math.max(0, t - seg.start);
  const length = Math.max(1, seg.end - seg.start);
  if (seg.activity !== "explore") {
    const walk = walkMs(seg, from, end, zoom, route);
    return { from, to: end, e: walk <= 0 ? 1 : smoothstep(Math.min(1, local / walk)) };
  }
  const legs = Math.max(1, Math.round(length / LEG_MS));
  const legMs = length / legs;
  const k = Math.min(legs - 1, Math.floor(local / legMs));
  // Stops 0..legs-2 are random; the last is the stored end point. Each leg
  // walks for a random share of its time, then pauses.
  const rng = seededRng(seg.rng);
  const draw = (): [number, number, number] => [0.03 + rng() * 0.94, 0.03 + rng() * 0.94, 0.6 + 0.4 * rng()];
  // On a big map the stops spread along the way to the end, each a little off
  // it: a blob wanders, but doesn't dash across the map on its last leg.
  const way = zoom === 1 ? [] : route(from, end);
  const stopAt = (i: number, [x, y]: [number, number, number]): GroundPoint => {
    if (i >= legs - 1) return end;
    if (zoom === 1) return snap({ x, y });
    const aim = alongPath(way, (i + 1) / legs);
    const near = (v: number, goal: number) => Math.min(0.97, Math.max(0.03, goal + (v - 0.5) / zoom));
    // The wander must be an easy walk from the way itself; if it isn't, the snap gives `aim` back: keep to the way
    // (and if even its own snap isn't an easy walk, stay on it: ground that can't be stood on beats a detour).
    const stop = snap({ x: near(x, aim.x), y: near(y, aim.y) }, aim);
    return stop === aim ? snap(aim, aim) : stop;
  };
  for (let i = 0; i < k - 1; i++) draw();
  const before = k > 0 ? draw() : null;
  const mine = draw();
  const prev = before ? stopAt(k - 1, before) : from;
  return { from: prev, to: stopAt(k, mine), e: smoothstep(Math.min(1, (local - k * legMs) / legMs / mine[2])) };
}

/** How long a blob takes to walk to `end` at the start of `seg` (not an
 * explore): a stroll, or to a meeting a hurry that grows with the distance. */
export function walkMs(seg: Segment, from: GroundPoint, end: GroundPoint, zoom = 1, route: Route = straight): number {
  const distance = pathLength(route(from, end)) * zoom;
  const speed = seg.activity === "meet" ? Math.min(HURRY_MAX * STROLL, Math.max(STROLL, distance / HURRY_MS)) : STROLL;
  return Math.min(Math.max(1, seg.end - seg.start), distance / speed);
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
