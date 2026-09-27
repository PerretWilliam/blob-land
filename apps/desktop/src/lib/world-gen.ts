import { seededRng } from "@blob-land/sim";
import { canHoldDecor, canRamp, canStep, cellAt, EDGES, type DecorKind, type IslandCell, type IslandLayout } from "./island";

/*
 * The public garden: one procedural island, the same on every client (it's
 * a pure function of its size, which the server sends — see gardenSize), so
 * nothing about the terrain is stored or sent. An ocean all round, a beach,
 * plains and woods, a small desert, a mountain with a snowy top, a river down
 * to the sea with footbridges, and a village clearing in the middle. Blobs
 * sleep in nests scattered over the island, a few to each.
 */

// Village clearing radius, in cells: grass and roads, no decor, a nest in the middle.
const VILLAGE = 3;
// How many blocks the mountain rises.
const PEAK = 4;
// A footbridge at least this often along the river, in cells.
const BRIDGE_EVERY = 10;
// Roughly how many blobs share a nest, on an island sized for its garden
// (gardenSize gives about (side / 6)² blobs); and how far apart nests keep, in cells.
const PER_NEST = 8;
const NEST_SPACING = 7;

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
  // (The loops below run over every cell many times: no temporary arrays in them.)
  for (let changed = true; changed; ) {
    changed = false;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const c = at(i, j)!;
        let low = Infinity;
        for (const e of EDGES) low = Math.min(low, at(i + e[1], j + e[2])?.height ?? 0);
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
  // Its cells in order, with whether a road ran there before it.
  const course: { i: number; j: number; road: boolean }[] = [];
  for (let steps = 0; steps < size * 2; steps++) {
    const c = at(ri, rj);
    const sea = (i: number, j: number) => land[j * size + i]! <= 0;
    if (!c || sea(ri, rj)) break;
    // It runs on through any lake it meets, and cuts through low hills.
    if (c.ground !== "water") {
      course.push({ i: ri, j: rj, road: c.ground === "road" });
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

  // Footbridges: wherever a road meets the river, and every so often along
  // it. Only across a straight stretch, onto level land on both banks.
  let sinceBridge = BRIDGE_EVERY;
  course.forEach(({ i, j, road }, k) => {
    sinceBridge++;
    const [prev, next] = [course[k - 1], course[k + 1]];
    if (!prev || !next || (prev.i !== next.i && prev.j !== next.j)) return;
    // Across the flow: along i when it runs along j, and the other way round.
    const [di, dj] = prev.i === next.i ? [1, 0] : [0, 1];
    const banks = [at(i - di, j - dj), at(i + di, j + dj)];
    if (!banks.every((b) => b && (canHoldDecor(b.ground) || b.ground === "road") && !b.height)) return;
    if (!road && sinceBridge < BRIDGE_EVERY) return;
    at(i, j)!.bridge = true;
    sinceBridge = 0;
  });

  // Ramps: keep adding one where a reachable cell meets an unreachable one a
  // block up or down, until everything that can be reached is.
  const home = Math.floor(half) * size + Math.floor(half);
  // Asked for again after every ramp: one pair of buffers for every walk, not a new one each time.
  const seen = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  const reachable = () => {
    seen.fill(0);
    let tail = 0;
    queue[tail++] = home;
    seen[home] = 1;
    for (let head = 0; head < tail; head++) {
      const n = queue[head]!;
      const i = n % size;
      const j = (n - i) / size;
      for (const e of EDGES) {
        const a = i + e[1];
        const b = j + e[2];
        const m = b * size + a;
        if (a < 0 || b < 0 || a >= size || b >= size || seen[m] || !canStep(layout, i, j, a, b)) continue;
        seen[m] = 1;
        queue[tail++] = m;
      }
    }
    return seen;
  };
  for (let guard = 0; guard < size * 4; guard++) {
    reachable();
    const candidates: number[] = [];
    for (let n = 0; n < size * size; n++) {
      const c = cells[n]!;
      if (c.ramp || !canRamp(c.ground)) continue;
      const i = n % size;
      const j = (n - i) / size;
      const h = c.height ?? 0;
      // The ramp would climb to the first neighbour one block up (see rampDirection).
      for (const e of EDGES) {
        const [a, b] = [i + e[1], j + e[2]];
        const up = at(a, b);
        if ((up?.height ?? 0) !== h + 1) continue;
        if (up!.ground !== "river" && seen[b * size + a] !== seen[n]) candidates.push(n);
        break;
      }
    }
    if (!candidates.length) break;
    cells[pick(candidates)]!.ramp = true;
  }

  // Decor, by ground, with woods where the forest noise is high. A cell no
  // one can reach gets something standing on it so nobody is sent there.
  reachable();
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

  // Nests, each two cells wide on a flat clearing: one in the middle of the
  // village, the others scattered wherever there's room, a few blobs to each.
  const nests = [{ i: Math.floor(half), j: Math.floor(half) }];
  const want = Math.max(1, Math.round((size / 6) ** 2 / PER_NEST));
  // The 4x4 cells around the corner (i, j) a nest sits on: all level, open ground.
  const clearing = (i: number, j: number) => {
    const around: IslandCell[] = [];
    for (let b = j - 2; b < j + 2; b++)
      for (let a = i - 2; a < i + 2; a++) {
        const c = at(a, b);
        if (!c || !seen[b * size + a] || c.height || c.ramp || !canHoldDecor(c.ground)) return null;
        around.push(c);
      }
    return around;
  };
  const spots: number[] = [];
  for (let n = 0; n < size * size; n++) if (clearing(n % size, Math.floor(n / size))) spots.push(n);
  for (let tries = 0; nests.length < want && spots.length && tries < want * 20; tries++) {
    const n = pick(spots);
    const [i, j] = [n % size, Math.floor(n / size)];
    if (nests.some((o) => Math.hypot(o.i - i, o.j - j) < NEST_SPACING)) continue;
    nests.push({ i, j });
  }
  for (const { i, j } of nests) for (const c of clearing(i, j) ?? []) delete c.decor;
  return { size, cells, nests: nests.map(({ i, j }) => ({ x: i / size, y: j / size, r: 1 / size })) };
}

