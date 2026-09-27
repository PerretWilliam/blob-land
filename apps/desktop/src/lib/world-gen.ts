import { seededRng } from "@blob-land/sim";
import { canRamp, canStep, cellAt, EDGES, type DecorKind, type IslandCell, type IslandLayout } from "./island";

/*
 * The public garden: one procedural island, the same on every client (it's
 * a pure function of its size), so nothing about the terrain is stored or
 * sent. An ocean all round, a beach, plains and woods, a small desert, a
 * mountain with a snowy top, a river down to the sea, and a village clearing
 * in the middle where everyone sleeps.
 */

// Side, in cells, for a garden of `blobs` blobs: grows in steps of 8 so the
// map (and everyone's place on it) only shifts now and then.
export const MIN_GARDEN = 24;
export const MAX_GARDEN = 128;
export function gardenSize(blobs: number): number {
  const side = Math.ceil((6 * Math.sqrt(Math.max(1, blobs))) / 8) * 8;
  return Math.min(MAX_GARDEN, Math.max(MIN_GARDEN, side));
}

// Village clearing radius, in cells: grass and roads, no decor, the nest in the middle.
const VILLAGE = 3;
// How many blocks the mountain rises.
const PEAK = 4;

/** Smooth value noise in [0, 1], sampled in cell units. The lattice is
 * hashed from absolute coordinates, so it doesn't depend on the map size. */
function valueNoise(salt: number) {
  const hash = (x: number, y: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  const at = (x: number, y: number) => {
    const [x0, y0] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [fade(x - x0), fade(y - y0)];
    const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * fx;
    const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  // Two octaves: broad shapes with a little ragged detail.
  return (x: number, y: number, scale: number) => (at(x / scale, y / scale) * 2 + at((2 * x) / scale + 17, (2 * y) / scale + 31)) / 3;
}

const family = (name: string, n: number) => Array.from({ length: n }, (_, k) => `${name}-${k + 1}` as DecorKind);
const TREES = family("tree", 6);
const SNOW_TREES = family("tree-snow", 6);
const BUSHES = family("bush", 4);
const SNOW_BUSHES = family("bush-snow", 4);
const ROCKS = family("rock", 8);
const DIRT_ROCKS = family("rock-dirt", 8);
const SAND_ROCKS = family("rock-sand", 8);
const CACTI = family("cactus", 5);

export function gardenIsland(size: number): IslandLayout {
  const rng = seededRng(0x61a4d3 ^ size);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)]!;
  const [coast, forest, dry, hills, lakes] = [1, 2, 3, 4, 5].map(valueNoise) as ReturnType<typeof valueNoise>[];
  const half = size / 2;
  // Centred coordinates, so the noise under a spot stays put when the map grows.
  const centred = (i: number, j: number) => [i + 0.5 - half, j + 0.5 - half] as const;
  const inVillage = (i: number, j: number, margin = 0) => Math.max(...centred(i, j).map(Math.abs)) <= VILLAGE + margin;
  // The mountain sits towards the back (top of the screen), the desert towards the right.
  const peak = { x: -0.26 * size, y: -0.22 * size, r: Math.max(6, 0.24 * size) };
  const desert = { x: 0.3 * size, y: -0.16 * size, r: 0.18 * size };

  const cells: IslandCell[] = [];
  const land: number[] = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const [x, y] = centred(i, j);
      const d = Math.hypot(x, y) / half;
      // > 0 is land: a round island with a ragged coast.
      const l = 0.82 - d * d + (coast(x, y, 7) - 0.5) * 0.6;
      land.push(l);
      const bump = Math.max(0, 1 - Math.hypot(x - peak.x, y - peak.y) / peak.r);
      let height = l > 0.15 ? Math.min(PEAK, Math.floor(bump * (PEAK + 0.9) * (0.85 + 0.3 * hills(x, y, 4)))) : 0;
      // A few low hills out in the plains.
      if (height === 0 && l > 0.3 && hills(x + 90, y, 5) > 0.72) height = 1;
      let ground: IslandCell["ground"];
      if (l <= 0) ground = "water";
      else if (l < 0.13 && height === 0) ground = "sand";
      else if (height >= 3) ground = "snow";
      else if (height === 2) ground = forest(x, y, 3) > 0.5 ? "dirt" : "grass";
      else if (Math.hypot(x - desert.x, y - desert.y) < desert.r + (dry(x, y, 4) - 0.5) * 6) ground = "sand";
      else if (height === 0 && l > 0.3 && lakes(x, y, 5) > 0.78) ground = "water";
      else ground = "grass";
      cells.push(height && ground !== "water" ? { ground, height } : { ground });
    }
  const layout: IslandLayout = { size, cells };
  const at = (i: number, j: number) => cellAt(layout, i, j);
  const neighbours = (i: number, j: number) => EDGES.map(([, di, dj]) => [i + di, j + dj] as const);

  // No cliff taller than one block: carve every cell down to one above its lowest neighbour.
  for (let changed = true; changed; ) {
    changed = false;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const c = at(i, j)!;
        const low = Math.min(...neighbours(i, j).map(([a, b]) => at(a, b)?.height ?? 0));
        if ((c.height ?? 0) > low + 1) {
          c.height = low + 1;
          changed = true;
        }
      }
  }

  // The village: flat grass around the middle.
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      if (!inVillage(i, j, 1)) continue;
      const c = at(i, j)!;
      c.ground = "grass";
      delete c.height;
    }
  // Four roads out of it, until they meet water, a slope or the desert.
  const mid = Math.floor(half);
  for (const [, di, dj] of EDGES)
    for (let k = 2; k < VILLAGE + 10; k++) {
      const c = at(mid + di * k, mid + dj * k);
      if (!c || c.ground !== "grass" || c.height) break;
      c.ground = "road";
    }

  // A river from the mountain's foot down to the sea, at ground level (the
  // pack's river pieces don't climb). It meanders but always heads out.
  // It starts at the mountain's foot on the screen's left, well clear of the village.
  let [ri, rj] = [Math.round(half + peak.x), Math.round(half + peak.y + peak.r)];
  for (let steps = 0; steps < size * 2; steps++) {
    const c = at(ri, rj);
    const sea = (i: number, j: number) => land[j * size + i]! <= 0;
    if (!c || sea(ri, rj)) break;
    // It runs on through any lake it meets, and cuts through low hills.
    if (c.ground !== "water") {
      c.ground = "river";
      delete c.height;
    }
    const out = Math.hypot(...centred(ri, rj));
    const options = neighbours(ri, rj).filter(([a, b]) => {
      const n = at(a, b);
      return n && (n.ground === "water" || ((n.height ?? 0) <= 1 && n.ground !== "river" && !inVillage(a, b, 2)));
    });
    if (!options.length) break;
    // Mostly towards the front of the island, drifting outwards and now and
    // then sideways; straight into the sea when it's next door.
    const score = ([a, b]: readonly [number, number]) => (sea(a, b) ? 9 : b - rj + 0.5 * (Math.hypot(...centred(a, b)) - out) + rng() * 1.4);
    [ri, rj] = options.reduce((best, o) => (score(o) > score(best) ? o : best));
  }

  // Ramps: keep adding one where a reachable cell meets an unreachable one a
  // block up or down, until everything that can be reached is.
  const home = Math.floor(half) * size + Math.floor(half);
  const reachable = () => {
    const seen = new Uint8Array(size * size);
    const queue = [home];
    seen[home] = 1;
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head]!;
      const [i, j] = [n % size, Math.floor(n / size)];
      for (const [a, b] of neighbours(i, j)) {
        const m = b * size + a;
        if (a < 0 || b < 0 || a >= size || b >= size || seen[m] || !canStep(layout, i, j, a, b)) continue;
        seen[m] = 1;
        queue.push(m);
      }
    }
    return seen;
  };
  for (let guard = 0; guard < size * 4; guard++) {
    const seen = reachable();
    const candidates: number[] = [];
    for (let n = 0; n < size * size; n++) {
      const c = cells[n]!;
      if (c.ramp || !canRamp(c.ground)) continue;
      const [i, j] = [n % size, Math.floor(n / size)];
      const h = c.height ?? 0;
      // The ramp would climb to the first neighbour one block up (see rampDirection).
      const up = neighbours(i, j).find(([a, b]) => (at(a, b)?.height ?? 0) === h + 1);
      if (up && at(...up)!.ground !== "river" && seen[up[1] * size + up[0]] !== seen[n]) candidates.push(n);
    }
    if (!candidates.length) break;
    cells[pick(candidates)]!.ramp = true;
  }

  // Decor, by ground, with woods where the forest noise is high. A cell no
  // one can reach gets something standing on it so nobody is sent there.
  const seen = reachable();
  for (let n = 0; n < size * size; n++) {
    const c = cells[n]!;
    if (c.ramp || c.ground === "water" || c.ground === "river" || c.ground === "road") continue;
    const [i, j] = [n % size, Math.floor(n / size)];
    if (!seen[n]) {
      c.decor = c.ground === "snow" ? pick(SNOW_TREES) : c.ground === "sand" ? pick(SAND_ROCKS) : pick(ROCKS);
      continue;
    }
    // Keep the village and the foot of every ramp clear.
    if (inVillage(i, j, 1) || neighbours(i, j).some(([a, b]) => at(a, b)?.ramp)) continue;
    const [x, y] = centred(i, j);
    const r = rng();
    let decor: DecorKind | undefined;
    if (c.ground === "snow") decor = r < 0.16 ? pick(SNOW_TREES) : r < 0.22 ? pick(SNOW_BUSHES) : undefined;
    else if (c.ground === "dirt") decor = r < 0.12 ? pick(DIRT_ROCKS) : r < 0.25 ? pick(TREES) : undefined;
    else if (c.ground === "sand") decor = land[n]! < 0.13 ? (r < 0.04 ? pick(SAND_ROCKS) : undefined) : r < 0.1 ? pick(CACTI) : r < 0.14 ? pick(SAND_ROCKS) : undefined;
    else if (forest(x, y, 4) > 0.58) decor = r < 0.6 ? pick(TREES) : r < 0.7 ? pick(BUSHES) : undefined;
    else decor = r < 0.03 ? pick(TREES) : r < 0.06 ? pick(BUSHES) : r < 0.075 ? pick(ROCKS) : undefined;
    if (decor) c.decor = decor;
  }

  // Everyone sleeps in the middle of the village: a nest about two cells wide.
  const r = 1 / size;
  return { size, cells, nest: { min: 0.5 - r, max: 0.5 + r } };
}
