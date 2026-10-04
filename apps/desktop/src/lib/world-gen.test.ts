/// <reference types="node" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canStep, cellAt, snapToGround, type IslandLayout } from "./island";
import { MAX_GARDEN, MIN_GARDEN } from "@blob-land/sim";
import { gardenIsland } from "./world-gen";

const REGIONS = [0, 1, 2, 3, 4, 5];
const nextTo = (i: number, j: number) => [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]] as const;

/** Every cell a blob can walk to from the middle of the village. */
function walkable(island: IslandLayout) {
  const { size } = island;
  const home = Math.floor(size / 2) * size + Math.floor(size / 2);
  const seen = new Set([home]);
  const queue = [home];
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head]!;
    const [i, j] = [n % size, Math.floor(n / size)];
    for (const [a, b] of nextTo(i, j)) {
      const m = b * size + a;
      if (a >= 0 && b >= 0 && a < size && b < size && !seen.has(m) && canStep(island, i, j, a, b)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen;
}

/** Whether the river runs unbroken from the tarn to the sea: through its lake, and under roads on culverts. */
function riverReachesSea(island: IslandLayout) {
  const { size } = island;
  const ground = (i: number, j: number) => cellAt(island, i, j)?.ground;
  // The sea: the water that reaches the edge of the map.
  const sea = new Set(island.cells.flatMap((c, n) => (c.ground === "water" && (n % size === 0 || n < size) ? [n] : [])));
  const flood = [...sea];
  for (let head = 0; head < flood.length; head++) {
    const n = flood[head]!;
    for (const [a, b] of nextTo(n % size, Math.floor(n / size)))
      if (ground(a, b) === "water" && !sea.has(b * size + a)) sea.add(b * size + a), flood.push(b * size + a);
  }
  const culvert = (i: number, j: number) =>
    ground(i, j) === "road" && ((ground(i - 1, j) === "river" && ground(i + 1, j) === "river") || (ground(i, j - 1) === "river" && ground(i, j + 1) === "river"));
  const flows = (i: number, j: number) => ground(i, j) === "river" || (ground(i, j) === "water" && !sea.has(j * size + i)) || culvert(i, j);
  const spring = island.cells.findIndex((c, n) => c.ground === "river" && nextTo(n % size, Math.floor(n / size)).some(([a, b]) => ground(a, b) === "ice"));
  const seen = new Set([spring]);
  const queue = spring < 0 ? [] : [spring];
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head]!;
    for (const [a, b] of nextTo(n % size, Math.floor(n / size))) {
      if (sea.has(b * size + a) && island.cells[n]!.ground === "river") return true;
      if (flows(a, b) && !seen.has(b * size + a)) seen.add(b * size + a), queue.push(b * size + a);
    }
  }
  return false;
}

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

    it(`rises a block at a time, its river running from the tarn to the sea, in every region, at ${size}`, () => {
      for (const region of REGIONS) {
        const island = gardenIsland(size, region);
        island.cells.forEach((c, n) => {
          const [i, j] = [n % size, Math.floor(n / size)];
          for (const [a, b] of nextTo(i, j)) {
            const o = cellAt(island, a, b);
            if (o && c.ground !== "water" && o.ground !== "water") expect(Math.abs((o.height ?? 0) - (c.height ?? 0)), `region ${region}, cell ${i},${j}`).toBeLessThanOrEqual(1);
          }
        });
        expect(riverReachesSea(island), `region ${region}`).toBe(true);
      }
    });

    it(`lets a blob walk from the village to anywhere it may stop, in every region, at ${size}`, () => {
      for (const region of REGIONS) {
        const island = gardenIsland(size, region);
        const seen = walkable(island);
        island.cells.forEach((c, n) => {
          const standable = c.ground !== "water" && c.ground !== "river" && !c.decor;
          if (standable) expect(seen.has(n), `region ${region}, cell ${n % size},${Math.floor(n / size)}`).toBe(true);
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
      }
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

  it("gives each region an island of its own", () => {
    const [a, b] = [gardenIsland(MAX_GARDEN, 0), gardenIsland(MAX_GARDEN, 1)];
    const alike = a.cells.filter((c, n) => c.ground === b.cells[n]!.ground && (c.height ?? 0) === (b.cells[n]!.height ?? 0)).length;
    expect(alike / a.cells.length).toBeLessThan(0.75);
  });

  // Every client lays the garden out itself and they have to agree: an island
  // that changes shape is a change for everyone at once, never a side effect.
  it("lays out exactly the island it always has", () => {
    const hash = (size: number, region = 0) => createHash("sha1").update(JSON.stringify(gardenIsland(size, region))).digest("hex");
    expect(hash(40)).toBe("3986aa4dd8e63b16a9262411e99183996f3186fe");
    expect(hash(128)).toBe("bc874ff8a1ccebdb3d7f42ecbb1b8b79f66970fe");
    expect(hash(128, 1)).toBe("5b5f549d9f573afe3084fa23031818b5cb67cc7f");
  });
});
