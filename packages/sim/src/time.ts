const HOUR = 60 * 60 * 1000;

/**
 * 1 in full daylight, 0 at night, easing over an hour at dawn (~06:00 UTC)
 * and dusk (~21:00 UTC). Blobs feel the same night (see `sleepPressure`),
 * so the sky and bedtime roughly agree. UTC, like every clock in the sim.
 */
export function daylight(t: number): number {
  const h = (t % (24 * HOUR)) / HOUR;
  const edge = (at: number, rising: boolean) => Math.min(1, Math.max(0, (rising ? h - at : at - h) + 0.5));
  return Math.min(edge(6, true), edge(21, false));
}
