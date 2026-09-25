import { hash01 } from "./hash";
import { dayStart } from "./time";

const HOUR = 60 * 60 * 1000;

export interface SleepWindow {
  start: number;
  end: number;
}

/**
 * Deterministic per (seed, day): starts ~22:00, jittered +/-60min, lasts
 * 7-9h (so `end` typically falls within the next calendar day). Shared by
 * `state.ts` (the sleep segment) and `events.ts` (the "wake" event, which
 * fires at this exact boundary — not a probability like discoveries).
 */
export function sleepWindow(seed: string, day: string): SleepWindow {
  const start = dayStart(day);
  const base = `${seed}|${day}`;
  const sleepStart = start + 22 * HOUR + (hash01(`${base}|sleepStart`) * 2 - 1) * HOUR;
  const sleepLen = (7 + hash01(`${base}|sleepLen`) * 2) * HOUR;
  return { start: sleepStart, end: sleepStart + sleepLen };
}
