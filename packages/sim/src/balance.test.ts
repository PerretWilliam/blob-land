import { describe, expect, it } from "vitest";
import { randomPersonality } from "./identity";
import { firstSegment } from "./life";
import { seededRng } from "./rng";
import { stepWorld, type World, type WorldBlob } from "./world";

const T0 = Date.UTC(2026, 8, 25, 8);
const DAY = 24 * 60 * 60 * 1000;

/**
 * The garden as a whole stays believable: a month of 80 blobs, three times
 * over, makes some couples and a few friends for life, not a garden of
 * rivals nor one where everyone is paired off. A tuning change that breaks
 * this is too strong, however reasonable it looks on one pair.
 */
describe("a month in the garden", () => {
  const tally: Record<string, number> = {};
  let started = 0;
  let ended = 0;
  const worlds: World[] = [];
  for (const run of [1, 2, 3]) {
    const rng = seededRng(run);
    const blobs = new Map<string, WorldBlob>();
    for (let i = 0; i < 80; i++) {
      const seed = `b${i}`;
      const identity = { sex: i % 2 ? "male" : "female", attraction: "any" } as const;
      blobs.set(seed, { seed, identity, personality: randomPersonality(rng), bornAt: T0, adultAt: T0, parents: null, traits: null, vitals: { energy: 0.9, mood: 0.1 }, last: firstSegment(T0, rng) });
    }
    const world: World = { blobs, relationships: new Map(), unions: [] };
    const step = stepWorld(world, T0 + 30 * DAY, rng, 60 * DAY);
    for (const r of world.relationships.values()) tally[r.status] = (tally[r.status] ?? 0) + 1;
    started += step.unionsStarted.length;
    ended += step.unionsEnded.length;
    worlds.push(world);
  }

  it("pairs some off, without pairing off everyone or breaking them all up", () => {
    expect(started).toBeGreaterThanOrEqual(3);
    expect(started).toBeLessThanOrEqual(0.25 * 3 * 80);
    expect(ended).toBeLessThanOrEqual(started / 2);
  });

  it("makes friends far more than rivals", () => {
    expect(tally.friends ?? 0).toBeGreaterThan(10 * (tally.rivals ?? 0));
    expect(tally.best_friends ?? 0).toBeGreaterThan(0);
  });

  it("gives each blob one best friend, two if it's very sociable", () => {
    for (const world of worlds) {
      const count = new Map<string, number>();
      for (const r of world.relationships.values()) if (r.status === "best_friends") for (const s of [r.a, r.b]) count.set(s, (count.get(s) ?? 0) + 1);
      for (const [seed, n] of count) expect(n).toBeLessThanOrEqual(world.blobs.get(seed)!.personality.sociability > 0.7 ? 2 : 1);
    }
  });
});
