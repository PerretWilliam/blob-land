import { NEST } from "./position";
import { between, pick, randomSeed, weighted, type Rng } from "./rng";

export type Activity = "sleep" | "wake" | "rest" | "explore" | "discover" | "meet";

/**
 * One stretch of a blob's life, generated at random and then stored: every
 * client plays back the same stored segments, so everyone watching sees the
 * same blob doing the same thing.
 */
export interface Segment {
  start: number;
  end: number;
  activity: Activity;
  /** A blobatar expression name (`idle`, `happy`, `mad`…). */
  expression: string;
  /** Where the blob is at the end of the segment, ground coordinates in [0, 1]. */
  x: number;
  y: number;
  /** Replays the walk inside the segment (an explore's stops) on every client. */
  rng: number;
  /** A meet's other blob. */
  with: string | null;
  /** What was found, for a discover; `kind:outcome` for a meet. */
  detail: string | null;
}

/** Slow-moving needs, carried from segment to segment. */
export interface Vitals {
  /** [0, 1]: drains while awake, refills asleep. */
  energy: number;
  /** [-1, 1]: meetings and finds push it, and it drifts back toward content. */
  mood: number;
}

/**
 * Which activity may follow which. This is what keeps randomness believable:
 * a blob wakes up before doing anything else, and doesn't nod off mid-walk.
 */
export const NEXT: Record<Activity, readonly Activity[]> = {
  sleep: ["wake"],
  wake: ["explore", "rest", "meet"],
  explore: ["explore", "rest", "discover", "meet", "sleep"],
  rest: ["explore", "discover", "meet", "sleep"],
  discover: ["explore", "rest", "meet", "sleep"],
  meet: ["explore", "rest", "discover", "meet", "sleep"],
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Shortest and longest a segment of each kind lasts (sleep is sized by need). */
export const DURATION: Record<Exclude<Activity, "sleep">, readonly [number, number]> = {
  wake: [5 * MIN, 15 * MIN],
  explore: [10 * MIN, 40 * MIN],
  rest: [15 * MIN, 60 * MIN],
  discover: [5 * MIN, 20 * MIN],
  meet: [3 * MIN, 8 * MIN],
};
export const SLEEP_HOURS = [5, 10] as const;

const DISCOVERIES = [
  "a smooth pebble",
  "a patch of warm moss",
  "a puddle that reflects the sky just right",
  "a shortcut through the reeds",
  "a spot that smells like rain",
  "a spider web strung with dew",
  "a hollow log worth investigating",
  "an unusually round cloud",
  "a feather, barely bent",
  "a snail going somewhere important",
  "a four-leaf clover",
  "a very flat stone",
];

const hourOf = (t: number) => {
  const d = new Date(t);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
};

/** How much a blob wants to sleep at `t`: tiredness, plus the pull of night (UTC). */
export function sleepPressure(vitals: Vitals, t: number): number {
  const h = hourOf(t);
  // Night pulls toward bed; broad daylight holds a tired blob up a while longer.
  const clock = h >= 21.5 || h < 5 ? 0.5 : h >= 20 ? 0.25 : h >= 9 && h < 18 ? -0.25 : 0;
  return 1 - vitals.energy + clock;
}

/** Whether a blob, having just finished `last`, is up for company. */
export const canSocialize = (last: Segment, vitals: Vitals, t: number) =>
  last.activity !== "sleep" && vitals.energy > 0.25 && sleepPressure(vitals, t) < 0.8;

export function awakeExpression(vitals: Vitals, rng: Rng): string {
  if (vitals.mood > 0.35) return "happy";
  if (vitals.mood < -0.3) return pick(rng, ["sad", "unsure"]);
  return pick(rng, ["idle", "happy", "idle"]);
}

const span = (rng: Rng, activity: keyof typeof DURATION) => between(rng, DURATION[activity][0], DURATION[activity][1]);

function nextActivity(prev: Activity, vitals: Vitals, t: number, rng: Rng): Exclude<Activity, "meet"> {
  if (prev === "sleep") return "wake";
  if (prev === "wake") return weighted(rng, { explore: 7, rest: 3 });
  const pressure = sleepPressure(vitals, t);
  // Past 1, bedtime isn't a maybe; from 0.8 up it's a growing one.
  if (pressure > 1) return "sleep";
  return weighted(rng, {
    explore: 5,
    rest: prev === "rest" ? 0 : 1 + 3 * (1 - vitals.energy),
    discover: prev === "discover" ? 0 : 1.2,
    sleep: pressure > 0.8 ? 60 * (pressure - 0.8) : 0,
  });
}

/** The blob's next solo segment, starting where and when `last` ended. */
export function nextSolo(last: Segment, vitals: Vitals, rng: Rng): Segment {
  const t = last.end;
  const activity = nextActivity(last.activity, vitals, t, rng);
  const base = { start: t, activity, rng: randomSeed(rng), with: null, detail: null };
  switch (activity) {
    case "sleep": {
      const hours = Math.min(SLEEP_HOURS[1], Math.max(SLEEP_HOURS[0], (1 - vitals.energy) * 9 * between(rng, 0.85, 1.15)));
      return { ...base, end: t + hours * HOUR, expression: "sleepy", x: between(rng, NEST.min, NEST.max), y: between(rng, NEST.min, NEST.max) };
    }
    case "wake":
      return { ...base, end: t + span(rng, "wake"), expression: "sleepy", x: last.x, y: last.y };
    case "explore":
      return { ...base, end: t + span(rng, "explore"), expression: awakeExpression(vitals, rng), x: between(rng, 0.03, 0.97), y: between(rng, 0.03, 0.97) };
    case "rest":
      // Out of the nest corner, somewhere comfy.
      return { ...base, end: t + span(rng, "rest"), expression: vitals.mood < -0.3 ? "sad" : "idle", x: between(rng, 0.25, 0.95), y: between(rng, 0.25, 0.95) };
    case "discover":
      return {
        ...base,
        end: t + span(rng, "discover"),
        expression: pick(rng, ["surprised", "thinking"]),
        x: between(rng, 0.2, 0.95),
        y: between(rng, 0.2, 0.95),
        detail: pick(rng, DISCOVERIES),
      };
  }
}

// Exponential pull of `v` toward `to`, halving the gap every `halfLife` ms.
const relax = (v: number, to: number, dt: number, halfLife: number) => to + (v - to) * 0.5 ** (dt / halfLife);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Energy lost per hour, by activity; sleep's is negative, it refills.
const DRAIN: Record<Activity, number> = { sleep: -1 / 8, wake: 1 / 30, rest: 1 / 40, explore: 1 / 16, discover: 1 / 16, meet: 1 / 14 };

/** Vitals after living through `seg`. */
export function liveThrough(vitals: Vitals, seg: Segment): Vitals {
  const dt = seg.end - seg.start;
  return {
    energy: clamp(vitals.energy - DRAIN[seg.activity] * (dt / HOUR), 0, 1),
    mood: clamp(relax(vitals.mood, 0.15, dt, 3 * HOUR) + (seg.activity === "discover" ? 0.1 : 0), -1, 1),
  };
}

/** Where a brand-new blob starts: standing somewhere, rested, content. */
export function firstSegment(at: number, rng: Rng, where?: { x: number; y: number }): Segment {
  const x = where?.x ?? between(rng, 0.3, 0.8);
  const y = where?.y ?? between(rng, 0.3, 0.8);
  return { start: at, end: at, activity: "rest", expression: "idle", x, y, rng: randomSeed(rng), with: null, detail: null };
}
