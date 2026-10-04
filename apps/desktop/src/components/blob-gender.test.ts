import { describe, expect, it } from "vitest";
import { genderAnchor } from "./blob-gender";

describe("genderAnchor", () => {
  it("finds the top of the head as the browser's own path sampling did", () => {
    // Measured with SVG's getPointAtLength (Chrome), before the outline was sampled in JS.
    const before: [string, number, number, number][] = [
      ["alice", 51.19, 27.58, 0],
      ["bob", 59.19, 13.74, -6.7],
      ["zed", 54.39, 17.02, -8],
      ["bench-3", 52.02, 15.32, -2],
      ["bench-10", 48.59, 18.12, 0],
      ["cmp2-7", 51.49, 17.98, -2.6],
    ];
    for (const [seed, x, y, tilt] of before) {
      const anchor = genderAnchor(seed, "male")!;
      expect(Math.abs(anchor.x - x)).toBeLessThan(1);
      expect(Math.abs(anchor.y - y)).toBeLessThan(0.6);
      expect(Math.abs(anchor.tilt - tilt)).toBeLessThan(4);
    }
  });
});
