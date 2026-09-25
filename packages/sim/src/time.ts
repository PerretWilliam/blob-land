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
