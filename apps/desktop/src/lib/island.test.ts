import { describe, expect, it } from "vitest";
import { canStep, defaultIsland, paintCell, rampInside, rampOutside, surfaceHeight, type IslandLayout } from "./island";

/** A 3x3 island of grass at `heights` (row by row), with a ramp on the middle cell. */
function hill(heights: number[]): IslandLayout {
  return { size: 3, cells: heights.map((height, n) => ({ ground: "grass", ...(height ? { height } : {}), ...(n === 4 ? { ramp: true as const } : {}) })) };
}

describe("ramps round a corner", () => {
  it("slope up both sides of an inside corner", () => {
    // Up to the north-west (i - 1) and the north-east (j - 1) at once.
    const island = hill([1, 1, 1, 1, 0, 0, 1, 0, 0]);
    expect(rampInside(island, 1, 1)).toBe("n");
    // Walked up its first side only, as before: the garden stays the same.
    expect(canStep(island, 1, 1, 0, 1)).toBe(true);
    // Low only at the opposite (south) corner, as the pack draws it.
    expect(surfaceHeight(island, 1, 1, 2, 2)).toBe(0);
    expect(surfaceHeight(island, 1, 1, 1, 2)).toBe(1);
    expect(surfaceHeight(island, 1, 1, 2, 1)).toBe(1);
  });

  it("rise to a corner when only the cell across it is up, and climb nowhere", () => {
    const island = hill([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(rampOutside(island, 1, 1)).toBe("n");
    expect(canStep(island, 1, 1, 0, 0)).toBe(false);
    expect(surfaceHeight(island, 1, 1, 1, 1)).toBe(1);
    expect(surfaceHeight(island, 1, 1, 1, 2)).toBe(0);
    expect(surfaceHeight(island, 1, 1, 2, 1)).toBe(0);
  });
});

describe("the bridge tool", () => {
  it("bridges a river, and only a river", () => {
    let island = defaultIsland(4);
    island = paintCell(island, 3, "river");
    island = paintCell(island, 3, "bridge");
    expect(island.cells[3]).toEqual({ ground: "river", bridge: true });
    expect(paintCell(island, 3, "bridge").cells[3]).toEqual({ ground: "river" });
    expect(paintCell(island, 1, "bridge")).toBe(island);
    // Dry land has no bridge to keep.
    expect(paintCell(island, 3, "grass").cells[3]).toEqual({ ground: "grass" });
  });
});
