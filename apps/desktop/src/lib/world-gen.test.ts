import { describe, expect, it } from "vitest";
import { canStep, snapToGround } from "./island";
import { gardenIsland, gardenSize, MAX_GARDEN, MIN_GARDEN } from "./world-gen";

describe("gardenIsland", () => {
  it("grows with the garden, in steps, within bounds", () => {
    expect(gardenSize(1)).toBe(MIN_GARDEN);
    expect(gardenSize(60)).toBeGreaterThan(MIN_GARDEN);
    expect(gardenSize(10_000)).toBe(MAX_GARDEN);
    expect(gardenSize(60) % 8).toBe(0);
  });

  for (const size of [MIN_GARDEN, 40, 64, MAX_GARDEN]) {
    it(`is the same everywhere, and has it all, at ${size}`, () => {
      const island = gardenIsland(size);
      expect(gardenIsland(size)).toEqual(island);
      const grounds = new Set(island.cells.map((c) => c.ground));
      for (const g of ["water", "sand", "grass", "snow", "river", "road"] as const) expect(grounds).toContain(g);
      expect(Math.max(...island.cells.map((c) => c.height ?? 0))).toBeGreaterThanOrEqual(3);
      expect(island.cells.some((c) => c.ramp)).toBe(true);
      // A real river, not a puddle.
      expect(island.cells.filter((c) => c.ground === "river").length).toBeGreaterThan(size / 4);
    });

    it(`lets a blob walk from the village to anywhere it may stop, at ${size}`, () => {
      const island = gardenIsland(size);
      const seen = new Set<number>();
      const home = Math.floor(size / 2) * size + Math.floor(size / 2);
      const queue = [home];
      seen.add(home);
      for (let head = 0; head < queue.length; head++) {
        const n = queue[head]!;
        const [i, j] = [n % size, Math.floor(n / size)];
        for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]] as const) {
          const m = b * size + a;
          if (a >= 0 && b >= 0 && a < size && b < size && !seen.has(m) && canStep(island, i, j, a, b)) {
            seen.add(m);
            queue.push(m);
          }
        }
      }
      island.cells.forEach((c, n) => {
        const standable = c.ground !== "water" && c.ground !== "river" && !c.decor;
        if (standable) expect(seen.has(n), `cell ${n % size},${Math.floor(n / size)}`).toBe(true);
      });
      // Sleep spots in the sim's nest corner land in the village.
      const bed = snapToGround(island, { x: 0.08, y: 0.08 });
      expect(Math.abs(bed.x - 0.5)).toBeLessThan(2 / size);
      expect(Math.abs(bed.y - 0.5)).toBeLessThan(2 / size);
    });
  }
});
