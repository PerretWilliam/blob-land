import { describe, expect, it } from "vitest";
import { NEST, positionAt } from "./position";
import { daylight } from "./sleep";
import { stateAt } from "./state";
import { dayStart } from "./time";

const SEED = "alice";
const DAY = "2026-09-25";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("positionAt", () => {
  it("is deterministic for the same seed and instant", () => {
    const t = dayStart(DAY) + 12 * HOUR + 1234;
    expect(positionAt(SEED, t)).toEqual(positionAt(SEED, t));
    expect(positionAt("bob", t)).toEqual(positionAt("bob", t));
  });

  it("stays within the ground", () => {
    for (let t = dayStart(DAY); t < dayStart(DAY) + 24 * HOUR; t += 7 * MIN) {
      const { x, y } = positionAt(SEED, t);
      for (const v of [x, y]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never jumps between close instants, across a whole day and every activity change", () => {
    const step = 100; // ms, about six frames
    for (let t = dayStart(DAY); t < dayStart(DAY) + 24 * HOUR; t += 2999) {
      const [a, b] = [positionAt(SEED, t), positionAt(SEED, t + step)];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.02);
    }
  });

  it("confines a sleeping blob to the nest", () => {
    let checked = 0;
    for (let t = dayStart(DAY); t < dayStart(DAY) + 24 * HOUR; t += MIN) {
      const { activity, since } = stateAt(SEED, t);
      // Skip the first two minutes: that is the walk home into the nest.
      if (activity !== "sleep" || t - since < 2 * MIN) continue;
      const { x, y } = positionAt(SEED, t);
      for (const v of [x, y]) {
        expect(v).toBeGreaterThanOrEqual(NEST.min);
        expect(v).toBeLessThanOrEqual(NEST.max);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("actually moves while exploring", () => {
    const morning = dayStart(DAY) + 10 * HOUR;
    const xs = Array.from({ length: 20 }, (_, i) => positionAt(SEED, morning + i * 5 * MIN).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.3);
  });

  it("only stops on walkable ground", () => {
    // Legs are 45s: each boundary is a stop (the previous leg's target).
    const westOnly = (p: { x: number }) => p.x < 0.5;
    for (let k = 0; k < 2000; k++) {
      const t = dayStart(DAY) + k * 45_000;
      if (stateAt(SEED, t - 45_000).activity === "sleep") continue;
      expect(positionAt(SEED, t, westOnly).x).toBeLessThan(0.5);
    }
  });
});

describe("daylight", () => {
  it("is day at noon and night at 02:00", () => {
    expect(daylight(SEED, dayStart(DAY) + 12 * HOUR)).toBe(1);
    expect(daylight(SEED, dayStart(DAY) + 2 * HOUR)).toBe(0);
  });
});
