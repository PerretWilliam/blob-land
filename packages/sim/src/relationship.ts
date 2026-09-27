import type { Rng } from "./rng";

/**
 * How two blobs feel about each other: three slow axes, and a status read
 * off them with hysteresis, so it never flickers between two labels.
 */

export const STATUSES = [
  "strangers",
  "acquaintances",
  "friends",
  "best_friends",
  "crush",
  "lovers",
  "complicated",
  "rivals",
  "ex",
  "family",
] as const;
export type RelationStatus = (typeof STATUSES)[number];

export type Kin = "parent" | "sibling";

export interface Relationship {
  /** Always ordered: a < b. */
  a: string;
  b: string;
  /** Each in [0, 100]. */
  friendship: number;
  romance: number;
  tension: number;
  /** [-1, 1], rolled once when they first meet and never changed: some pairs
   * just click, some just grate. It's what makes each pair its own story. */
  chemistry: number;
  status: RelationStatus;
  kin: Kin | null;
  /** They were together once, and it ended. Cleared once they're real friends again. */
  ex: boolean;
  meetings: number;
  lastMetAt: number | null;
}

export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export function newRelationship(x: string, y: string, rng: Rng, kin: Kin | null = null): Relationship {
  const [a, b] = x < y ? [x, y] : [y, x];
  // Family starts out fond of each other; everyone else starts from nothing.
  const friendship = kin ? 55 : 0;
  // Bell-shaped: most pairs are lukewarm, a few click or grate hard.
  const chemistry = (rng() + rng() + rng()) / 1.5 - 1;
  return { a, b, friendship, romance: 0, tension: 0, chemistry, status: kin ? "family" : "strangers", kin, ex: false, meetings: 0, lastMetAt: null };
}

const HOUR = 60 * 60 * 1000;
const clamp = (v: number) => Math.min(100, Math.max(0, v));
// Exponential pull of `v` toward `to`, halving the gap every `halfLife` ms.
const relax = (v: number, to: number, dt: number, halfLife: number) => to + (v - to) * 0.5 ** (dt / halfLife);

/**
 * Time apart, applied lazily when they next meet: tempers cool, friendship
 * fades slowly (never below a mild baseline), and romance fades — slower
 * for a couple.
 */
export function decay(rel: Relationship, now: number, together: boolean): Relationship {
  if (rel.lastMetAt === null || now <= rel.lastMetAt) return rel;
  const dt = now - rel.lastMetAt;
  return {
    ...rel,
    tension: relax(rel.tension, 0, dt, 7 * 24 * HOUR),
    friendship: rel.friendship > 20 ? relax(rel.friendship, 20, dt, 20 * 24 * HOUR) : rel.friendship,
    // Even a couple's spark needs tending, just more slowly.
    romance: relax(rel.romance, 0, dt, (together ? 25 : 10) * 24 * HOUR),
  };
}

// [enter, leave]: a status is entered at the first number, only left below the second.
const RIVALS_TENSION = [60, 45] as const;
const COMPLICATED_TENSION = [50, 40] as const;
const CRUSH_ROMANCE = [40, 30] as const;
const BEST_FRIENDSHIP = [75, 65] as const;
const FRIENDSHIP = [40, 32] as const;

/**
 * The status the axes spell out, given what it was before (for hysteresis)
 * and the facts the axes can't carry: family, an active union.
 */
export function relationStatus(rel: Relationship, together: boolean): RelationStatus {
  const over = (value: number, [enter, leave]: readonly [number, number], status: RelationStatus) =>
    value >= (rel.status === status ? leave : enter);

  if (rel.kin) return "family";
  if (together) return "lovers";
  if (rel.ex) return "ex";
  if (over(rel.tension, RIVALS_TENSION, "rivals") && rel.friendship < 30) return "rivals";
  if (over(rel.tension, COMPLICATED_TENSION, "complicated") && (rel.friendship >= 40 || rel.romance >= 40)) return "complicated";
  if (over(rel.romance, CRUSH_ROMANCE, "crush")) return "crush";
  if (over(rel.friendship, BEST_FRIENDSHIP, "best_friends") && rel.tension < 30) return "best_friends";
  if (over(rel.friendship, FRIENDSHIP, "friends")) return "friends";
  return rel.meetings > 0 ? "acquaintances" : "strangers";
}

/** Axis changes from one meeting. */
export interface Delta {
  friendship: number;
  romance: number;
  tension: number;
}

/** Applies one meeting's delta and re-reads the status. Exes who become real
 * friends again stop being "the ex". */
export function applyDelta(rel: Relationship, d: Delta, at: number, together: boolean): Relationship {
  const next: Relationship = {
    ...rel,
    friendship: clamp(rel.friendship + d.friendship),
    romance: clamp(rel.romance + d.romance),
    tension: clamp(rel.tension + d.tension),
    meetings: rel.meetings + 1,
    lastMetAt: at,
  };
  if (next.ex && next.friendship >= 60 && next.tension < 25) next.ex = false;
  return { ...next, status: relationStatus(next, together) };
}

/** Ready to become a couple: in love, not fighting, and actually friends. */
export const readyForUnion = (rel: Relationship) => rel.romance >= 65 && rel.tension < 40 && rel.friendship >= 30;

/** A couple that can't go on: too much fighting, or the spark is gone. */
export const readyToBreakUp = (rel: Relationship) => rel.tension >= 70 || rel.romance < 35;
