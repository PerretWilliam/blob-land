import { useSyncExternalStore } from "react";
import { daylight } from "@blob-land/sim";

/** Dev only: knobs to play with while the app runs (the dev panel). Left alone, or in a build, every one is a no-op. */
export const DEV = import.meta.env.DEV;

export interface Knobs {
  /** How many times faster than real time the scenes run (0 pauses). */
  speed: number;
  /** Forces the daylight, 0 (night) to 1 (day); null lets the sky follow the clock. */
  sky: number | null;
  /** Times the blobs' size. */
  blobSize: number;
  /** Plays the scenes as for a player who asked for reduced motion. */
  reducedMotion: boolean;
}

const DEFAULTS: Knobs = { speed: 1, sky: null, blobSize: 1, reducedMotion: false };
let knobs = DEFAULTS;
const listeners = new Set<() => void>();
// Where the sped-up clock stood when the speed last changed.
let anchor = { real: Date.now(), fake: Date.now() };

/** Real time, or the dev clock's. */
export const devNow = () => (DEV ? anchor.fake + (Date.now() - anchor.real) * knobs.speed : Date.now());
/** How far the dev clock is ahead of real time: added to a clock that already runs by itself (the garden's). */
export const devSkew = () => devNow() - Date.now();
/** The daylight at `t`: the sky's, unless the dev panel forces it. */
export const skyAt = (t: number) => knobs.sky ?? daylight(t);

export function setKnobs(patch: Partial<Knobs>) {
  // Re-anchored, so changing the speed carries on from the time it was.
  if (patch.speed !== undefined) anchor = { real: Date.now(), fake: devNow() };
  knobs = { ...knobs, ...patch };
  listeners.forEach((l) => l());
}
export const resetKnobs = () => setKnobs({ ...DEFAULTS, speed: 1 });

export function useKnobs(): Knobs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => knobs,
  );
}
