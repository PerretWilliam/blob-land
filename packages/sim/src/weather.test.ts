import { describe, expect, it } from "vitest";
import { randomPersonality } from "./identity";
import { firstSegment } from "./life";
import { seededRng } from "./rng";
import { forecast, seasonAt, SPELL, weatherAt, type Spell, type Weather } from "./weather";
import { stepWorld, type World, type WorldBlob } from "./world";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1);

describe("forecast", () => {
  const year = forecast([], T0 + 365 * DAY, seededRng(1), 365 * DAY);

  it("rolls one spell after another, on the hour, up to the horizon", () => {
    for (let i = 1; i < year.length; i++) expect(year[i]!.start - year[i - 1]!.start).toBe(SPELL);
    expect(year[0]!.start % SPELL).toBe(0);
    expect(year[year.length - 1]!.start + SPELL).toBeGreaterThan(T0 + 365 * DAY);
  });

  it("keeps to the season, and gathers clouds before it rains", () => {
    for (let i = 1; i < year.length; i++) {
      const [prev, s] = [year[i - 1]!, year[i]!];
      if (s.weather === "snow") expect(["snowfall", "thaw"]).toContain(seasonAt(s.start));
      if (prev.weather === "clear") expect(["rain", "storm", "snow"]).not.toContain(s.weather);
    }
    const seen = new Set(year.map((s) => s.weather));
    for (const w of ["clear", "cloudy", "rain", "storm", "snow", "fog"] as Weather[]) expect(seen).toContain(w);
  });

  it("carries on from what was stored, dropping what's long past", () => {
    const now = forecast([], T0 + DAY, seededRng(2));
    const later = forecast(now, T0 + 4 * DAY, seededRng(3));
    expect(later[0]!.start).toBeGreaterThan(T0 + 4 * DAY - 2 * DAY - SPELL);
    for (const s of now.filter((s) => s.start >= later[0]!.start)) expect(later).toContainEqual(s);
  });

  it("reads the weather at a time", () => {
    const spells: Spell[] = [
      { start: T0, weather: "rain" },
      { start: T0 + SPELL, weather: "fog" },
    ];
    expect(weatherAt(spells, T0 - 1)).toBe("clear");
    expect(weatherAt(spells, T0 + 1)).toBe("rain");
    expect(weatherAt(spells, T0 + SPELL)).toBe("fog");
  });
});

describe("a rainy week", () => {
  // The same blobs, a week of rain against a week of sunshine.
  function week(weather: Weather) {
    const rng = seededRng(4);
    const blobs = new Map<string, WorldBlob>();
    for (let i = 0; i < 20; i++) {
      const seed = `b${i}`;
      blobs.set(seed, { seed, identity: { sex: "none", attraction: "any" }, personality: randomPersonality(rng), bornAt: T0, adultAt: T0, parents: null, traits: null, vitals: { energy: 0.9, mood: 0.1 }, last: firstSegment(T0, rng) });
    }
    const spells = Array.from({ length: 60 }, (_, i) => ({ start: T0 + i * SPELL, weather }));
    const world: World = { blobs, relationships: new Map(), unions: [], weather: spells };
    const step = stepWorld(world, T0 + 7 * DAY, rng, 8 * DAY);
    const time = (a: string) => step.segments.filter((s) => s.activity === a).reduce((sum, s) => sum + s.end - s.start, 0);
    return { explore: time("explore"), rest: time("rest"), meetings: step.meetings.length };
  }
  const [rain, sun] = [week("rain"), week("clear")];

  it("keeps blobs in more, without stopping them seeing each other", () => {
    expect(rain.explore).toBeLessThan(sun.explore * 0.8);
    expect(rain.rest).toBeGreaterThan(sun.rest);
    expect(rain.meetings).toBeGreaterThan(sun.meetings * 0.5);
  });
});
