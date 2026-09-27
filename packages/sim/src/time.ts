/** UTC-only for v1 (see plan decision #4). `tz` is accepted but unused — kept
 * in signatures so multi-timezone support doesn't require an API change. */
export type Tz = "UTC";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for the UTC day containing `t` (epoch ms). */
export function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Epoch ms at 00:00:00 UTC for a `YYYY-MM-DD` day key. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return dayKey(dayStart(day) + n * DAY_MS);
}

const HOUR = 60 * 60 * 1000;

/**
 * 1 in full daylight, 0 at night, easing over an hour at dawn (~06:00 UTC)
 * and dusk (~21:00 UTC). Blobs feel the same night (see `sleepPressure`),
 * so the sky and bedtime roughly agree.
 */
export function daylight(t: number): number {
  const h = (t % (24 * HOUR)) / HOUR;
  const edge = (at: number, rising: boolean) => Math.min(1, Math.max(0, (rising ? h - at : at - h) + 0.5));
  return Math.min(edge(6, true), edge(21, false));
}
