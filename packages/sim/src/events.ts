import { hash01 } from "./hash";
import { sleepWindow } from "./sleep";
import { addDays, dayStart } from "./time";

export interface DayEvent {
  type: "discover" | "wake";
  /** Epoch ms, within the day. */
  at: number;
  /** Deterministic pick from a small vocabulary — what journal() turns into text. Unused for "wake". */
  detail: string;
}

const DISCOVERIES = [
  "a smooth pebble",
  "a patch of warm moss",
  "a puddle that reflects the sky just right",
  "a shortcut through the reeds",
  "a spot that smells like rain",
  "a spider web strung with dew",
  "a hollow log worth investigating",
  "an unusually round cloud",
];

// Explore hours, UTC — events only land while the blob is plausibly awake.
const EXPLORE_START_H = 8;
const EXPLORE_END_H = 20;

/**
 * Deterministic events for one UTC day, hashed on `seed|day`: exactly one
 * "wake" (the sleep->explore boundary stateAt already computes, via the
 * previous day's sleepWindow — no probability, unlike discoveries) plus
 * 0-2 "discover" events.
 */
export function eventsOfDay(seed: string, day: string): DayEvent[] {
  const base = `${seed}|${day}`;
  const roll = hash01(`${base}|count`);
  const count = roll < 0.55 ? 0 : roll < 0.9 ? 1 : 2;

  const start = dayStart(day);
  const windowMs = (EXPLORE_END_H - EXPLORE_START_H) * 60 * 60 * 1000;

  const events: DayEvent[] = [
    { type: "wake", at: sleepWindow(seed, addDays(day, -1)).end, detail: "" },
  ];
  for (let i = 0; i < count; i++) {
    const at = start + EXPLORE_START_H * 60 * 60 * 1000 + hash01(`${base}|at${i}`) * windowMs;
    const detail = DISCOVERIES[Math.floor(hash01(`${base}|detail${i}`) * DISCOVERIES.length)]!;
    events.push({ type: "discover", at, detail });
  }
  // Chronological, since callers scan for "the event at/after t".
  return events.sort((a, b) => a.at - b.at);
}
