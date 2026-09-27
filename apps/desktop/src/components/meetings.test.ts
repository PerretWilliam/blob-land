import type { Segment } from "@blob-land/sim";
import { describe, expect, it } from "vitest";
import { gardenIsland } from "@/lib/world-gen";
import { expressionNamed, targets, type SceneBlob } from "./scene";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 1, 12);
const layout = gardenIsland(128);
const tile = 1 / layout.size;

const seg = (s: Partial<Segment> & Pick<Segment, "start" | "end" | "activity" | "x" | "y">): Segment => ({ expression: "idle", rng: 1, with: null, detail: null, ...s });
const blob = (seed: string, segments: Segment[]): SceneBlob => ({ seed, label: seed, segments, expression: expressionNamed("idle"), activity: "meet", sex: "none", attraction: "any" });

// A meets B around (0.5, 0.5), in the sim's wide ring. A gets there first;
// B is off exploring until 3 minutes in. They part at 8 minutes.
const RING = 0.057;
const a = blob("a", [
  seg({ start: T0 - 10 * MIN, end: T0, activity: "rest", x: 0.45, y: 0.5 }),
  seg({ start: T0, end: T0 + 8 * MIN, activity: "meet", x: 0.5 - RING, y: 0.5, with: ["b"], detail: "chat:good" }),
  seg({ start: T0 + 8 * MIN, end: T0 + 20 * MIN, activity: "rest", x: 0.4, y: 0.4 }),
]);
const b = blob("b", [
  seg({ start: T0 - 10 * MIN, end: T0 + 3 * MIN, activity: "rest", x: 0.56, y: 0.52 }),
  seg({ start: T0 + 3 * MIN, end: T0 + 8 * MIN, activity: "meet", x: 0.5 + RING, y: 0.5, with: ["a"], detail: "chat:good" }),
]);
const at = (t: number) => targets(layout, [a, b], t);
const apart = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) / tile;

describe("a meeting", () => {
  it("keeps its place while the others are still to come, and waits for them", () => {
    const early = at(T0 + 2.5 * MIN);
    const later = at(T0 + 3.5 * MIN);
    expect(apart(early[0]!, later[0]!)).toBeLessThan(0.01);
    expect(early[0]!.comingToMeet).toBe(true);
  });

  it("stands its blobs side by side, once they're all there", () => {
    const [pa, pb] = at(T0 + 6 * MIN);
    expect(apart(pa!, pb!)).toBeLessThan(1.5);
    expect(pa!.comingToMeet).toBe(false);
  });

  it("walks away from where the blob stood, without a hop", () => {
    const before = at(T0 + 8 * MIN - 1)[0]!;
    const after = at(T0 + 8 * MIN + 1)[0]!;
    expect(apart(before, after)).toBeLessThan(0.05);
  });
});
