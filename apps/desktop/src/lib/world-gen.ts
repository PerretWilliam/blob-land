import { seededRng } from "@blob-land/sim";
import { canHoldDecor, canRamp, canStep, cellAt, EDGES, type DecorKind, type IslandCell, type IslandLayout } from "./island";

/*
 * The public garden: one procedural island, the same on every client (it's
 * a pure function of its size, which the server sends — see gardenSize), so
 * nothing about the terrain is stored or sent. Four roads leave the village
 * in the middle for the sea, and each quarter between them is one biome: the
 * mountain at the back, the desert on the right, the meadow in front and the
 * forest on the left. They're laid out in fractions of the island, so each
 * grows with it. Only the mountain rises, in terraces up to a snowy top with
 * a frozen tarn; a road climbs it, and the river leaves the tarn down
 * waterfalls, under the west road, through the forest and its lake to a wide
 * mouth on the sea. A beach all round. Blobs sleep in nests, a few to each.
 */

// Village radius, in cells: a ring road round a green with a nest in the middle.
const VILLAGE = 3;
// How many blocks the mountain rises.
const PEAK = 4;
// A footbridge at least this often along the river, in cells.
const BRIDGE_EVERY = 8;
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
  const [coast, woods] = [1, 2].map(valueNoise) as ReturnType<typeof valueNoise>[];
  const half = size / 2;
  const mid = Math.floor(half);
  // Centred coordinates, so the noise under a spot stays put when the map grows.
  const centred = (i: number, j: number) => [i + 0.5 - half, j + 0.5 - half] as const;
  const inVillage = (i: number, j: number, margin = 0) => Math.max(Math.abs(i - mid), Math.abs(j - mid)) <= VILLAGE + margin;
  // The roads run along row and column `mid`: the quarters between them are the biomes.
  const biome = (i: number, j: number) => (i < mid ? (j < mid ? "mountain" : "forest") : j < mid ? "desert" : "meadow");
  // The mountain fills the back quarter: rounded-square terraces T cells wide.
  const peak = { x: -0.24 * size, y: -0.24 * size, r: Math.max(7, 0.22 * size) };
  const T = Math.max(2, Math.round(peak.r / (PEAK + 1.5)));

  // > 0 is land: a round island with a ragged coast.
  const land: number[] = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const [x, y] = centred(i, j);
      const d = Math.hypot(x, y) / half;
      land.push(0.82 - d * d + (coast(x, y, 7) - 0.5) * 0.45);
    }
  // How many steps each cell is from the sea: the mountain comes down to it in terraces too.
  const shore = new Int32Array(size * size).fill(-1);
  const front: number[] = [];
  land.forEach((l, n) => l <= 0 && front.push(n) && (shore[n] = 0));
  for (let head = 0; head < front.length; head++) {
    const n = front[head]!;
    const [i, j] = [n % size, Math.floor(n / size)];
    for (const [, di, dj] of EDGES) {
      const [a, b] = [i + di, j + dj];
      if (a < 0 || b < 0 || a >= size || b >= size || shore[b * size + a] !== -1) continue;
      shore[b * size + a] = shore[n]! + 1;
      front.push(b * size + a);
    }
  }
  const heights = land.map((_, n) => {
    const [i, j] = [n % size, Math.floor(n / size)];
    if (biome(i, j) !== "mountain") return 0;
    const [x, y] = centred(i, j);
    const out = ((x - peak.x) ** 4 + (y - peak.y) ** 4) ** 0.25;
    // Down to the ground short of the roads, the village and the beach, whatever the island's size.
    const edge = Math.min(-x - 1, -y - 1, Math.max(-x, -y) - VILLAGE - 0.5, shore[n]! - 2);
    return Math.max(0, Math.min(PEAK, Math.ceil((peak.r - out) / T), Math.ceil(edge / T)));
  });
  // Snow on the top two levels (just the top on a small island's low mountain), bare earth below.
  const top = Math.max(...heights);
  const cells: IslandCell[] = heights.map((height, n) => {
    const l = land[n]!;
    let ground: IslandCell["ground"];
    if (l <= 0) ground = "water";
    else if (height >= Math.max(2, top - 1)) ground = "snow";
    else if (height >= 2) ground = "dirt";
    else if ((l < 0.13 && !height) || biome(n % size, Math.floor(n / size)) === "desert") ground = "sand";
    else ground = "grass";
    return height ? { ground, height } : { ground };
  });
  const layout: IslandLayout = { size, cells };
  const at = (i: number, j: number) => cellAt(layout, i, j);
  const neighbours = (i: number, j: number) => EDGES.map(([, di, dj]) => [i + di, j + dj] as const);
  const sea = (i: number, j: number) => (land[j * size + i] ?? 0) <= 0;
  // (The loops below run over every cell many times: no temporary arrays in them.)

  // A frozen tarn on the top: the highest two by two cells that are level,
  // nearest the peak. Its far corner (pi, pj) is where the road arrives.
  let [pi, pj] = [mid, mid];
  for (let h = PEAK, best = Infinity; h > 0 && best === Infinity; h--)
    for (let j = 1; j < size; j++)
      for (let i = 1; i < size; i++) {
        const block = [at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)];
        const far = Math.hypot(...centred(i, j).map((v, k) => v - (k ? peak.y : peak.x)));
        if (block.every((c) => c?.height === h) && far < best) [best, pi, pj] = [far, i, j];
      }
  for (const [a, b] of [[pi - 1, pj - 1], [pi, pj - 1], [pi - 1, pj], [pi, pj]] as const) at(a, b)!.ground = "ice";

  // The village: a green inside a ring road, and four roads from it to the sea.
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      if (!inVillage(i, j, 1)) continue;
      const c = at(i, j)!;
      c.ground = Math.max(Math.abs(i - mid), Math.abs(j - mid)) === VILLAGE ? "road" : "grass";
      delete c.height;
    }
  const pave = (i: number, j: number) => {
    const c = at(i, j);
    if (!c || (c.ground !== "grass" && c.ground !== "sand") || c.height) return false;
    c.ground = "road";
    return true;
  };
  for (const [, di, dj] of EDGES) for (let k = VILLAGE + 1; pave(mid + di * k, mid + dj * k); k++);
  // The mountain road: off the back road, up the terraces to the tarn, a slope at each step.
  for (let i = mid - 1; ; i--) {
    const [c, next] = [at(i + 1, pj)!, at(i, pj)];
    if (!next || next.ground === "ice" || next.ground === "water") break;
    const rise = (next.height ?? 0) - (c.height ?? 0);
    if (rise < 0 || rise > 1) break;
    if (rise === 1) c.ramp = true;
    next.ground = "road";
  }

  // The river, from the tarn straight down the mountain (each terrace a
  // waterfall: a river falls on its own, see rampDirection) and under the
  // west road, then meandering through the forest to the sea.
  const course: { i: number; j: number; road: boolean }[] = [];
  const bend = Math.max(1, Math.round(0.05 * size));
  const period = Math.max(3, 0.07 * size);
  let [ri, rj] = [pi - 1, pj + 1];
  const base = ri;
  for (let steps = 0; steps < size * 2; steps++) {
    const c = at(ri, rj);
    if (!c || sea(ri, rj)) break;
    course.push({ i: ri, j: rj, road: c.ground === "road" });
    c.ground = "river";
    delete c.ramp;
    // Straight until past the road, then winding: sideways when off its line, else on.
    const line = rj <= mid + 2 ? base : base + Math.round(bend * Math.sin((rj - mid - 2) / period));
    if (line !== ri) ri += Math.sign(line - ri);
    else rj++;
    const next = at(ri, rj);
    if (next && (next.height ?? 0) > (c.height ?? 0)) next.height = c.height;
  }

  // Down by the sea it widens: the last stretch gets a twin alongside.
  const twins = new Map<number, number>();
  for (let k = Math.max(1, course.length - 6); k < course.length - 1; k++) {
    const [prev, { i, j }, next] = [course[k - 1]!, course[k]!, course[k + 1]!];
    if (prev.i !== next.i) continue;
    const twin = at(i + 1, j);
    if (!twin || !canHoldDecor(twin.ground) || twin.height) continue;
    twin.ground = "river";
    twins.set(k, j * size + i + 1);
  }

  // Still water: a lake on the river in the forest, a pond in the meadow.
  const lake = course.find(({ j }) => j >= mid + 0.18 * size);
  const ponds = [
    { i: lake?.i ?? -99, j: lake?.j ?? -99, r: Math.max(2, 0.05 * size) },
    { i: mid + 0.22 * size, j: mid + 0.24 * size, r: Math.max(1.5, 0.04 * size) },
  ];
  for (const p of ponds)
    for (let j = Math.floor(p.j - p.r); j <= p.j + p.r; j++)
      for (let i = Math.floor(p.i - p.r); i <= p.i + p.r; i++) {
        const c = at(i, j);
        if (c && !c.height && c.ground !== "road" && Math.hypot(i - p.i, j - p.j) <= p.r + 0.3) c.ground = "water";
      }

  // Bridges, only across a straight stretch onto level land on both banks:
  // every so often a footbridge, and one broad one across the mouth. Where
  // a road met the river, the road carries on over it, the river below
  // through a culvert.
  let sinceBridge = BRIDGE_EVERY;
  let broad = false;
  course.forEach(({ i, j, road }, k) => {
    sinceBridge++;
    if (at(i, j)!.ground !== "river") return;
    const [prev, next] = [course[k - 1], course[k + 1]];
    if (!prev || !next || (prev.i !== next.i && prev.j !== next.j)) return;
    // Across the flow: along i when it runs along j, and the other way round.
    const [di, dj] = prev.i === next.i ? [1, 0] : [0, 1];
    const twin = twins.get(k);
    const reach = twin === undefined ? 1 : 2;
    const level = (b: IslandCell | undefined) => b && (canHoldDecor(b.ground) || b.ground === "road") && (b.height ?? 0) === (at(i, j)!.height ?? 0);
    if (!level(at(i - di, j - dj)) || !level(at(i + di * reach, j + dj * reach))) return;
    if (road && twin === undefined) {
      at(i, j)!.ground = "road";
      return;
    }
    if (twin !== undefined ? broad : sinceBridge < BRIDGE_EVERY) return;
    at(i, j)!.bridge = true;
    if (twin !== undefined) {
      cells[twin]!.bridge = true;
      broad = true;
    }
    sinceBridge = 0;
  });

  // Waterfalls come down between slopes, as the pack draws them: the land
  // either side of one slopes up the same way where it can.
  for (const { i, j } of course) {
    const c = at(i, j)!;
    if (c.ground !== "river") continue;
    const h = c.height ?? 0;
    const up = EDGES.find(([, di, dj]) => at(i + di, j + dj)?.ground === "river" && (at(i + di, j + dj)!.height ?? 0) === h + 1);
    if (!up) continue;
    const [, di, dj] = up;
    for (const [a, b] of [[i + dj, j + di], [i - dj, j - di]] as const) {
      const side = at(a, b);
      if (side && canRamp(side.ground) && side.ground !== "river" && side.ground !== "road" && (side.height ?? 0) === h && (at(a + di, b + dj)?.height ?? 0) === h + 1) side.ramp = true;
    }
  }

  // Ramps: keep adding one where a reachable cell meets an unreachable one a
  // block up or down, until everything that can be reached is (a terrace the
  // river cuts off, mostly).
  const home = mid * size + mid;
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
      // A river is never walked: a slope of it would lead nowhere.
      if (c.ramp || !canRamp(c.ground) || c.ground === "river") continue;
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

  // Decor, by biome. A cell no one can reach gets something standing on it
  // so nobody is sent there.
  reachable();
  for (let n = 0; n < size * size; n++) {
    const c = cells[n]!;
    if (c.ramp || !canHoldDecor(c.ground)) continue;
    const [i, j] = [n % size, Math.floor(n / size)];
    if (!seen[n]) {
      c.decor = c.ground === "snow" ? pick(SNOW_TREES) : c.ground === "sand" ? pick(SAND_ROCKS) : pick(ROCKS);
      continue;
    }
    // Keep the village and the foot of every slope clear.
    if (inVillage(i, j, 1) || neighbours(i, j).some(([a, b]) => at(a, b)?.ramp)) continue;
    const [x, y] = centred(i, j);
    const r = rng();
    const beach = land[n]! < 0.13 && !c.height;
    let decor: DecorKind | undefined;
    if (c.ground === "snow") decor = r < 0.14 ? pick(SNOW_TREES) : r < 0.2 ? pick(SNOW_BUSHES) : undefined;
    else if (c.ground === "dirt") decor = r < 0.12 ? pick(DIRT_ROCKS) : r < 0.18 ? pick(TREES) : undefined;
    else if (beach) decor = r < 0.03 ? pick(SAND_ROCKS) : undefined;
    else if (c.ground === "sand") decor = r < 0.08 ? pick(CACTI) : r < 0.12 ? pick(SAND_ROCKS) : undefined;
    else if (biome(i, j) === "forest") decor = woods(x, y, 5) > 0.42 ? (r < 0.62 ? pick(TREES) : r < 0.72 ? pick(BUSHES) : undefined) : r < 0.05 ? pick(BUSHES) : undefined;
    else if (biome(i, j) === "mountain") decor = r < 0.08 ? pick(ROCKS) : r < 0.16 ? pick(TREES) : undefined;
    else decor = r < 0.04 ? pick(BUSHES) : r < 0.06 ? pick(TREES) : r < 0.07 ? pick(ROCKS) : undefined;
    if (decor) c.decor = decor;
  }

  // Nests, each two cells wide on a flat clearing: one in the middle of the
  // village, the others as near it as they fit, a few blobs to each.
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
  const spots: { i: number; j: number }[] = [];
  for (let n = 0; n < size * size; n++) if (clearing(n % size, Math.floor(n / size))) spots.push({ i: n % size, j: Math.floor(n / size) });
  spots.sort((p, q) => Math.hypot(p.i - mid, p.j - mid) - Math.hypot(q.i - mid, q.j - mid));
  const nests: { i: number; j: number }[] = [];
  for (const spot of spots) if (nests.length < want && nests.every((o) => Math.hypot(o.i - spot.i, o.j - spot.j) >= NEST_SPACING)) nests.push(spot);
  for (const { i, j } of nests) for (const c of clearing(i, j) ?? []) delete c.decor;
  return { size, cells, nests: nests.map(({ i, j }) => ({ x: i / size, y: j / size, r: 1 / size })) };
}
