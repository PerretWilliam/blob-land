import { seededRng } from "@blob-land/sim";
import { describe, expect, it } from "vitest";
import type { Visitor } from "./api";
import { advanceLife, farewell, newLife, stayFor, welcome, type LocalLife } from "./life";

const T0 = Date.UTC(2026, 9, 3, 9);
const HOUR = 60 * 60 * 1000;
const SOCIAL = { sociability: 1, temper: 0.2, playfulness: 0.8, romance: 0.5, chronotype: 0.5, kindness: 0.8, loyalty: 0.5, curiosity: 0.5 };

const visitor = (relationship: Visitor["relationship"] = null): Visitor => ({
  seed: "pal",
  name: "Pal",
  sex: "male",
  attraction: "any",
  personality: SOCIAL,
  gait: null,
  vitals: { energy: 0.9, mood: 0.4 },
  relationship,
  partner: false,
});

/** Lives `life` hour by hour, as the app does while open, until `end`. */
function live(life: LocalLife, from: number, end: number) {
  const lived = [];
  for (let t = from; t <= end; t += HOUR) {
    const step = advanceLife("me", life, t);
    life = step.life;
    lived.push(...step.lived);
  }
  return { life, lived };
}

describe("visits", () => {
  it("stay a few hours between strangers, up to two days between close friends", () => {
    for (let i = 0; i < 200; i++) {
      const rng = seededRng(i);
      expect(stayFor(null, rng)).toBeGreaterThanOrEqual(3 * HOUR);
      expect(stayFor(null, rng)).toBeLessThanOrEqual(12 * HOUR);
      expect(stayFor({ friendship: 100, romance: 0 }, rng)).toBeLessThanOrEqual(48 * HOUR);
    }
  });

  it("live the stay together on the island, then go home, keeping how it went", () => {
    let meetings = 0;
    for (let run = 0; run < 5; run++) {
      let life = advanceLife("me", { ...newLife({ sex: "female", attraction: "any" }, T0), personality: SOCIAL }, T0).life;
      life = welcome("me", life, visitor(), T0);
      const until = life.guest!.until;
      const after = live(life, T0, until + 2 * HOUR);
      const withPal = after.lived.filter((s) => s.with?.includes("pal"));
      meetings += withPal.length;
      // Never after the stay (but for joining one last moment), and gone once it's over.
      for (const s of withPal) expect(s.start).toBeLessThan(until + 15 * 60_000);
      expect(after.life.guest).toBeUndefined();
      if (withPal.length) expect(after.life.met?.pal?.relationship.meetings).toBeGreaterThan(0);
      for (const m of after.life.album ?? []) expect(m.with).toEqual([{ seed: "pal", name: "Pal" }]);
      expect(after.life.segments[after.life.segments.length - 1]!.end).toBeGreaterThan(until + HOUR);
    }
    expect(meetings).toBeGreaterThan(0);
  });

  it("pick up from the garden, or from here if they met here since", () => {
    const life = newLife({ sex: "female", attraction: "any" }, T0);
    const garden = { friendship: 60, romance: 0, tension: 0, chemistry: 0, status: "friends" as const, kin: null, ex: false, meetings: 4, lastMetAt: T0 - HOUR };
    const first = welcome("me", life, visitor(garden), T0);
    expect(first.met?.pal?.relationship).toMatchObject({ a: "me", b: "pal", friendship: 60 });
    const here = { ...first.met!.pal!.relationship, friendship: 75, lastMetAt: T0 };
    expect(welcome("me", { ...first, met: { pal: { name: "Pal", relationship: here } } }, visitor(garden), T0).met?.pal?.relationship.friendship).toBe(75);
  });

  it("can end early", () => {
    let life = welcome("me", advanceLife("me", newLife({ sex: "female", attraction: "any" }, T0), T0).life, visitor(), T0);
    life = advanceLife("me", life, T0).life;
    life = farewell(life, T0 + 60_000);
    expect(life.guest).toBeUndefined();
    expect(life.segments.every((s) => s.start <= T0 + 60_000)).toBe(true);
  });
});
