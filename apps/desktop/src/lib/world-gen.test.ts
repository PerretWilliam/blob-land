/// <reference types="node" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canStep, snapToGround } from "./island";
import { MAX_GARDEN, MIN_GARDEN } from "@blob-land/sim";
import { gardenIsland } from "./world-gen";

describe("gardenIsland", () => {
  for (const size of [MIN_GARDEN, 40, 64, MAX_GARDEN]) {
    it(`is the same everywhere, and has it all, at ${size}`, () => {
      const island = gardenIsland(size);
      expect(gardenIsland(size)).toEqual(island);
      const grounds = new Set(island.cells.map((c) => c.ground));
      for (const g of ["water", "sand", "grass", "snow", "river", "road"] as const) expect(grounds).toContain(g);
      // A mountain, if a low one on the smallest islands.
      expect(Math.max(...island.cells.map((c) => c.height ?? 0))).toBeGreaterThanOrEqual(size >= 40 ? 3 : 2);
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
      // Sleep spots in the sim's nest corner land in the blob's own nest,
      // the first one in the village; a blob can get to every nest.
      const bed = snapToGround(island, { x: 0.08, y: 0.08 });
      expect(Math.abs(bed.x - 0.5)).toBeLessThan(2 / size);
      expect(Math.abs(bed.y - 0.5)).toBeLessThan(2 / size);
      island.nests!.forEach((nest, k) => {
        const p = snapToGround(island, { x: 0.08, y: 0.08 }, k);
        expect(Math.hypot(p.x - nest.x, p.y - nest.y)).toBeLessThan(2 / size);
        expect(seen.has(Math.floor(p.y * size) * size + Math.floor(p.x * size))).toBe(true);
      });
    });

    it(`spreads the nests out, a few blobs to each, and bridges the river, at ${size}`, () => {
      const island = gardenIsland(size);
      const nests = island.nests!;
      expect(nests.length).toBeGreaterThanOrEqual(Math.max(1, Math.floor((size / 6) ** 2 / 16)));
      for (const a of nests) for (const b of nests) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y) * size).toBeGreaterThanOrEqual(7);
      const bridges = island.cells.filter((c) => c.bridge);
      expect(bridges.length).toBeGreaterThan(0);
      expect(bridges.every((c) => c.ground === "river")).toBe(true);
    });
  }

  // Every client lays the garden out itself and they have to agree: an island
  // that changes shape is a change for everyone at once, never a side effect.
  it("lays out exactly the island it always has", () => {
    const hash = (size: number) => createHash("sha1").update(JSON.stringify(gardenIsland(size))).digest("hex");
    expect(hash(40)).toBe("4ac8de01270de00a50f3b6a5443a898964adcc4f");
    expect(hash(128)).toBe("214ffbb999b492ee6db6d7586cc4d6443727d704");
  });
});
