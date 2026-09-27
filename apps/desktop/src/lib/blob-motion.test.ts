import { happy, mad, thinking } from "blobatar/expression";
import { idleAt, idleSeeds, idleTransforms } from "blobatar/idle";
import { _posed, lerpPose } from "blobatar/internal";
import { describe, expect, it } from "vitest";
import { Affine, breatheTransform, eyeTransform, glanceTransform, moveAt } from "./blob-motion";

/** An SVG transform list, as blobatar writes them, read back into an Affine. */
function parse(list: string): Affine {
  const m = new Affine();
  for (const [, op, args] of list.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = args!.trim().split(/[\s,]+/).map(Number);
    if (op === "translate") m.translate(n[0]!, n[1] ?? 0);
    else if (op === "rotate") m.rotate(n[0]!);
    else if (op === "scale") m.scale(n[0]!, n[1] ?? n[0]!);
    else throw new Error(`unexpected ${op}`);
  }
  return m;
}

// Blobatar rounds its strings to three decimals, which shifts a translation
// by up to 50 × 0.0005 through the scales about the viewBox centre.
const close = (a: Affine, b: Affine) => {
  for (const k of ["a", "b", "c", "d"] as const) expect(a[k]).toBeCloseTo(b[k], 2);
  for (const k of ["e", "f"] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.06);
};

describe("blob motion", () => {
  it("moves the eyes exactly as blobatar's own idle layer does", () => {
    for (const seed of ["alain", "bench-3", "zoé", "🦊"]) {
      const figure = _posed(seed);
      const seeds = idleSeeds(seed);
      for (const expression of [undefined, happy, mad, thinking]) {
        const pose = lerpPose(undefined, expression?.p, 1);
        for (const t of [0, 1234, 4567, 9999]) {
          const f = idleAt(seeds, t, 1, pose.shake);
          const theirs = idleTransforms({ eyes: figure.eyeFrames }, pose, f);
          close(breatheTransform(new Affine(), f), parse(theirs.breathe));
          figure.eyeFrames.forEach((e, i) => {
            close(eyeTransform(new Affine(), e, i, pose, f.rockp), parse(theirs.eye[i]!));
            close(glanceTransform(new Affine(), e, i, f), parse(theirs.glance[i]!));
          });
        }
      }
    }
  });

  it("plays meeting moves like the stylesheet", () => {
    // fx-hop: up 12% halfway through its 700ms, down again at the end.
    expect(moveAt("play", 1, 0, 2, 350, 0)!.ty).toBeCloseTo(-0.12);
    expect(moveAt("play", 1, 0, 2, 700, 0)!.ty).toBeCloseTo(0);
    // fx-nod waits for its turn: the second speaker holds still for the first 1.8s.
    expect(moveAt("chat", 1, 1, 2, 900, 0)!.rot).toBe(0);
    // fx-sway alternates: back where it started after two swings.
    expect(moveAt("dance", 1, 0, 2, 1800, 0)!.rot).toBeCloseTo(-8);
    // fx-lean plays once from arrival, towards the others, and stays there.
    expect(moveAt("hug", -1, 0, 2, 0, 5000)).toMatchObject({ rot: -9, tx: -0.12 });
    expect(moveAt("hug", 1, 0, 2, 0, 0)!.rot).toBe(0);
  });
});
