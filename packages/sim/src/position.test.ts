import { describe, expect, it } from "vitest";
import { firstSegment, liveThrough, nextSolo, type Segment } from "./life";
import { gardenSize, legIn, MAX_GARDEN, MIN_GARDEN, NEST, positionOn, REGION_CAP } from "./position";
import { seededRng } from "./rng";

const T0 = Date.UTC(2026, 8, 25, 8);
const HOUR = 60 * 60 * 1000;

function life(seed: number, hours: number): Segment[] {
  const rng = seededRng(seed);
  let vitals = { energy: 0.9, mood: 0.1 };
  const segs = [firstSegment(T0, rng)];
  while (segs.at(-1)!.end < T0 + hours * HOUR) {
    const seg = nextSolo(segs.at(-1)!, vitals, rng);
    vitals = liveThrough(vitals, seg);
    segs.push(seg);
  }
  return segs;
}

describe("positionOn", () => {
  const segs = life(7, 48);

  it("never jumps between close instants, across segment boundaries too", () => {
    for (let t = T0; t < T0 + 48 * HOUR; t += 2_999) {
      const [a, b] = [positionOn(segs, t), positionOn(segs, t + 100)];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.02);
    }
  });

  it("stays on the ground", () => {
    for (let t = T0; t < T0 + 48 * HOUR; t += 60_000) {
      const { x, y } = positionOn(segs, t);
      for (const v of [x, y]) expect(v >= 0 && v <= 1).toBe(true);
    }
  });

  it("sleeps in the nest once it got there", () => {
    let checked = 0;
    for (const seg of segs.filter((s) => s.activity === "sleep")) {
      const { x, y } = positionOn(segs, seg.start + (seg.end - seg.start) / 2);
      for (const v of [x, y]) expect(v >= NEST.min && v <= NEST.max).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("snaps every stop onto standable ground", () => {
    const westOnly = (p: { x: number; y: number }) => ({ x: Math.min(p.x, 0.5), y: p.y });
    for (let t = T0; t < T0 + 48 * HOUR; t += 45_000) expect(positionOn(segs, t, westOnly).x).toBeLessThanOrEqual(0.5);
  });
});

describe("gardenSize", () => {
  it("grows with the garden, in steps, within bounds", () => {
    expect(gardenSize(1)).toBe(MIN_GARDEN);
    expect(gardenSize(60)).toBeGreaterThan(MIN_GARDEN);
    expect(gardenSize(60) % 8).toBe(0);
    expect(gardenSize(10_000)).toBe(MAX_GARDEN);
    // A full region is just about as big as an island gets.
    expect(gardenSize(REGION_CAP)).toBeGreaterThanOrEqual(MAX_GARDEN - 8);
  });
});

describe("legIn", () => {
  const meet: Segment = { start: T0, end: T0 + 8 * 60_000, activity: "meet", expression: "idle", x: 0.5, y: 0.5, rng: 1, with: ["b"], detail: "chat:good" };
  const arrival = (from: { x: number; y: number }) => {
    let t = T0;
    while (legIn(meet, from, t, undefined, 16).e < 1) t += 1000;
    return (t - T0) / 1000;
  };

  it("hurries to a meeting the more the farther it is, within a cap", () => {
    const near = arrival({ x: 0.48, y: 0.5 });
    const mid = arrival({ x: 0.3, y: 0.5 });
    const far = arrival({ x: 0.05, y: 0.5 });
    // Near: a plain stroll, soon there. Farther: there in about the same time, walking faster.
    expect(near).toBeLessThan(20);
    expect(mid).toBeLessThanOrEqual(46);
    // Very far: the cap on speed shows, it takes longer, but still within the meeting.
    expect(far).toBeGreaterThan(mid);
    expect(far).toBeLessThan(8 * 60);
  });
});
