import { weighted, type Rng } from "./rng";

const HOUR = 60 * 60 * 1000;

/**
 * The garden's year, by the UTC calendar: the same everywhere, since the
 * garden is one world. More than four, each with something of its own to
 * watch: petals, fireflies, shooting stars, falling leaves…
 */
export const SEASONS = ["snowfall", "thaw", "blossom", "bloom", "fireflies", "summer", "shooting_stars", "falling_leaves", "mist"] as const;
export type Season = (typeof SEASONS)[number];

// January to December.
const BY_MONTH: readonly Season[] = ["snowfall", "thaw", "blossom", "blossom", "bloom", "fireflies", "summer", "shooting_stars", "falling_leaves", "falling_leaves", "mist", "snowfall"];

export const seasonAt = (t: number): Season => BY_MONTH[new Date(t).getUTCMonth()]!;

export const WEATHERS = ["clear", "cloudy", "rain", "storm", "snow", "fog"] as const;
export type Weather = (typeof WEATHERS)[number];

/** A stretch of one weather, until the next spell starts. */
export interface Spell {
  start: number;
  weather: Weather;
}

/** How long a spell lasts: weather holds a while, and spells start on the hour (UTC). */
export const SPELL = 3 * HOUR;
// How likely the weather is to stay as it is from one spell to the next.
const HOLDS = 0.55;

// What each season's sky tends to, before HOLDS keeps it as it was.
const CLIMATE: Record<Season, Partial<Record<Weather, number>>> = {
  snowfall: { clear: 2, cloudy: 3, snow: 4, fog: 1, rain: 0.3 },
  thaw: { clear: 2, cloudy: 3, rain: 3, fog: 2, snow: 1 },
  blossom: { clear: 4, cloudy: 2, rain: 2.5, fog: 0.5 },
  bloom: { clear: 5, cloudy: 2, rain: 1.5, storm: 0.3 },
  fireflies: { clear: 6, cloudy: 1.5, rain: 1, storm: 0.7 },
  summer: { clear: 7, cloudy: 1, rain: 0.5, storm: 1 },
  shooting_stars: { clear: 7, cloudy: 1, rain: 0.5, storm: 0.8 },
  falling_leaves: { clear: 3, cloudy: 3, rain: 2.5, storm: 0.5, fog: 1 },
  mist: { clear: 1.5, cloudy: 3, rain: 3, fog: 4 },
};

/** The weather at `t`: the last spell started by then (clear before any). */
export function weatherAt(spells: readonly Spell[], t: number): Weather {
  let w: Weather = "clear";
  for (const s of spells) {
    if (s.start > t) break;
    w = s.weather;
  }
  return w;
}

/**
 * `spells` rolled on to `until`, one spell at a time, each from the one
 * before and the season: weather holds a while, rain and storms gather from
 * clouds rather than out of a clear sky, and nothing falls out of season
 * (no snow in summer). Spells over `keep` before `until` are dropped, and
 * after a gap that long the sky starts afresh. Random, then stored, as the
 * blobs' lives are.
 */
export function forecast(spells: readonly Spell[], until: number, rng: Rng, keep = 2 * 24 * HOUR): Spell[] {
  const out = spells.filter((s) => s.start + SPELL > until - keep);
  let t = out.length > 0 ? out[out.length - 1]!.start + SPELL : Math.floor((until - keep) / SPELL) * SPELL;
  let prev: Weather = out[out.length - 1]?.weather ?? "clear";
  for (; t <= until; t += SPELL) {
    const climate = CLIMATE[seasonAt(t)];
    let next = climate[prev] && rng() < HOLDS ? prev : weighted(rng, climate);
    if (prev === "clear" && (next === "rain" || next === "storm" || next === "snow")) next = "cloudy";
    out.push({ start: t, weather: next });
    prev = next;
  }
  return out;
}

/** Rain or a storm: blobs keep in. */
export const wet = (w: Weather) => w === "rain" || w === "storm";
