import { hash01 } from "./hash";
import { addDays, dayKey, dayStart } from "./time";

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

/**
 * 1 in full daylight, 0 at night, easing over the hour centred on each sleep
 * boundary (dawn/dusk). Night is this blob's own sleep window, so the sky and
 * stateAt's "sleep" agree by construction.
 */
export function daylight(seed: string, t: number): number {
  const day = dayKey(t);
  let night = 0;
  for (const d of [addDays(day, -1), day]) {
    const { start, end } = sleepWindow(seed, d);
    const edge = Math.min(t - start, end - t) / HOUR + 0.5;
    night = Math.max(night, Math.min(1, Math.max(0, edge)));
  }
  return 1 - night;
}
