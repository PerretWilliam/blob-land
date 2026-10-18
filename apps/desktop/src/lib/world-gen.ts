import { seededRng } from "@blob-land/sim";
import { canHoldDecor, canRamp, canStep, cellAt, EDGES, type DecorKind, type Ground, type IslandCell, type IslandLayout } from "./island";

/*
 * The public garden: one procedural island per region, the same on every
 * client (it's a pure function of the region and its size, which the server
 * sends — see gardenSize), so nothing about the terrain is stored or sent.
 *
 * Every island is made the same way. A mountain at the back rises in
 * terraces to a snowy top with a frozen tarn, and falls in cliffs where it
 * meets the sea. The river leaves the tarn down waterfalls, cuts its valley
 * through the hills and runs through a lake in the woods to the sea. One side
 * of the island is dry (sand, mesas, cacti, an oasis), the other wet (woods
 * along the river); rolling meadows lie in front, with a pond, and a beach
 * all round the low coast. A village in the middle, and roads from it to
 * whatever there is to see, winding round the hills and climbing them on
 * slopes. Blobs sleep in nests, a few to each, scattered out from the village.
 *
 * Where exactly each thing lies, how the coast and the hills run, which side
 * is dry: that's the region's own (its dice and its noise), and it stays put
 * as the island grows.
 */

// Village radius, in cells: a ring road round a green with a nest in the middle.
const VILLAGE = 3;
// The most blocks the mountain rises, on a big island.
const MAX_PEAK = 7;
// A footbridge at least this often along the river, in cells.
const BRIDGE_EVERY = 8;
// Roughly how many blobs share a nest, on an island sized for its garden
// (gardenSize gives about (side / 6)² blobs); and how far apart nests keep, in cells.
const PER_NEST = 8;
const NEST_SPACING = 7;
// Slopes beyond the ones needed to reach everything: about one every this many cells along a cliff.
const RAMP_SPACING = 9;

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
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * fx;
    const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  // Two octaves: broad shapes with a little ragged detail.
  return (x: number, y: number, scale: number) => (at(x / scale, y / scale) * 2 + at((2 * x) / scale + 17, (2 * y) / scale + 31)) / 3;
}

/** A min-heap of numbers by cost, for the searches below. */
class Queue {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    let k = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.items[k] = this.items[p]!;
      this.keys[k] = this.keys[p]!;
      k = p;
    }
    this.items[k] = item;
    this.keys[k] = key;
  }
  pop(): number {
    const top = this.items[0]!;
    const item = this.items.pop()!;
    const key = this.keys.pop()!;
    const n = this.items.length;
    if (n) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1]! < this.keys[c]!) c++;
        if (this.keys[c]! >= key) break;
        this.items[k] = this.items[c]!;
        this.keys[k] = this.keys[c]!;
        k = c;
      }
      this.items[k] = item;
      this.keys[k] = key;
    }
    return top;
  }
}

// A step's direction, as an index into EDGES; START for where a search begins.
const START = 4;
const OPPOSITE = [2, 3, 0, 1];

/**
 * The cheapest way across the grid from any of `starts` to a cell `goal`
 * accepts, as cells, start first; or null. `price(from, to, edge, came)`
 * prices one step (`came`: the edge the walk arrived at `from` by, START at a
 * start, unless it's given a `heading`), null where it can't go. Steps are
 * told which way the walk came, so they can price a turn or forbid one.
 */
function cheapestWay(
  size: number,
  starts: Iterable<number>,
  goal: (n: number) => boolean,
  price: (from: number, to: number, edge: number, came: number) => number | null,
  heading = START,
): number[] | null {
  const states = size * size * 5;
  const cost = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const done = new Uint8Array(states);
  const queue = new Queue();
  for (const n of starts) {
    cost[n * 5 + heading] = 0;
    queue.push(n * 5 + heading, 0);
  }
  while (queue.size) {
    const s = queue.pop();
    if (done[s]) continue;
    done[s] = 1;
    const n = (s / 5) | 0;
    const came = s % 5;
    if (goal(n)) {
      const way: number[] = [];
      for (let k = s; k >= 0; k = prev[k]!) way.push((k / 5) | 0);
      return way.reverse();
    }
    const i = n % size;
    const j = (n - i) / size;
    for (let e = 0; e < 4; e++) {
      const a = i + EDGES[e]![1];
      const b = j + EDGES[e]![2];
      if (a < 0 || b < 0 || a >= size || b >= size) continue;
      const m = b * size + a;
      const step = price(n, m, e, came);
      if (step === null) continue;
      const t = m * 5 + e;
      if (cost[s]! + step < cost[t]!) {
        cost[t] = cost[s]! + step;
        prev[t] = s;
        queue.push(t, cost[t]!);
      }
    }
  }
  return null;
}

const family = (name: string, n: number) => Array.from({ length: n }, (_, k) => `${name}-${k + 1}` as DecorKind);
const POPLARS: DecorKind[] = ["tree-1", "tree-2"];
const PINES: DecorKind[] = ["tree-3", "tree-4"];
const ROUND_TREES: DecorKind[] = ["tree-5", "tree-6"];
const SNOW_TREES = family("tree-snow", 6);
const BUSHES = family("bush", 4);
const SNOW_BUSHES = family("bush-snow", 4);
const ROCKS = family("rock", 8);
const DIRT_ROCKS = family("rock-dirt", 8);
const SAND_ROCKS = family("rock-sand", 8);
const CACTI = family("cactus", 5);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function gardenIsland(size: number, region = 0): IslandLayout {
  // The region's own dice, for its look (the same at every size), and for the details.
  const look = seededRng(Math.imul(region + 1, 0x9e3779b1) ^ 0x5eed);
  const rng = seededRng(0x61a4d3 ^ size ^ Math.imul(region, 0x2545f491));
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)]!;
  const noise = () => valueNoise(Math.floor(look() * 0x7fffffff));
  const [coast, warp, hills, dryNoise, woods, scree, meander, rough] = Array.from({ length: 8 }, noise) as ReturnType<typeof valueNoise>[];
  const N = size * size;
  const half = size / 2;
  const mid = Math.floor(half);
  // Centred coordinates, so the noise under a spot stays put when the map grows.
  const xOf = (n: number) => (n % size) + 0.5 - half;
  const yOf = (n: number) => Math.floor(n / size) + 0.5 - half;
  const iOf = (n: number) => n % size;
  const jOf = (n: number) => Math.floor(n / size);
  const near = (n: number, e: number) => {
    const a = (n % size) + EDGES[e]![1];
    const b = Math.floor(n / size) + EDGES[e]![2];
    return a < 0 || b < 0 || a >= size || b >= size ? -1 : b * size + a;
  };
  const chebyshev = (n: number, i: number, j: number) => Math.max(Math.abs(iOf(n) - i), Math.abs(jOf(n) - j));
  const inVillage = (n: number, margin = 0) => chebyshev(n, mid, mid) <= VILLAGE + margin;
  const home = mid * size + mid;
  /** The last land cell going out from the middle at `angle`. */
  const coastAt = (angle: number) => {
    let last = mid * size + mid;
    for (let r = 0; r < half * 1.5; r += 0.5) {
      const [i, j] = [Math.floor(half + Math.cos(angle) * r), Math.floor(half + Math.sin(angle) * r)];
      if (i < 0 || j < 0 || i >= size || j >= size || land[j * size + i]! <= 0) break;
      last = j * size + i;
    }
    return last;
  };

  /** Points to pass on the way from cell `a` to cell `b`, so it bends: `count`
   * of them, pushed off the straight line by up to `bend` of its length. */
  const bends = (a: number, b: number, count: number, bend: number, dice: () => number) => {
    const [di, dj] = [iOf(b) - iOf(a), jOf(b) - jOf(a)];
    const points: number[] = [];
    for (let k = 1; k <= count; k++) {
      const [t, push] = [k / (count + 1), (dice() - 0.5) * 2 * bend];
      const [i, j] = [Math.round(iOf(a) + di * t - dj * push), Math.round(jOf(a) + dj * t + di * push)];
      if (i >= 0 && j >= 0 && i < size && j < size) points.push(j * size + i);
    }
    return points;
  };
  const within = (target: number, r: number) => (n: number) => Math.hypot(iOf(n) - iOf(target), jOf(n) - jOf(target)) <= r;
  /** The way a walk heads at its end, as an index into EDGES. */
  const headingOf = (way: number[]) => (way.length < 2 ? START : EDGES.findIndex((_, e) => near(way[way.length - 2]!, e) === way[way.length - 1]));

  // Where things lie, as angles round the middle: -3π/4 is the back of the
  // screen. The mountain is at the back, give or take; the dry side and the
  // wet side either side of it, which way round is the region's own.
  const mountainAngle = -0.75 * Math.PI + (look() - 0.5) * 0.9;
  const side = look() < 0.5 ? 1 : -1;
  const dryAngle = mountainAngle + side * (0.55 + look() * 0.25) * Math.PI;
  const wetAngle = mountainAngle - side * (0.55 + look() * 0.25) * Math.PI;
  const frontAngle = mountainAngle + Math.PI + (look() - 0.5) * 0.6;
  const peakAway = 0.52 + look() * 0.06;
  const peakSize = 0.34 + look() * 0.08;
  const hillLine = 0.6 + look() * 0.04;
  const islets = Math.floor(look() * 4);
  const isletAngles = Array.from({ length: islets }, () => look() * 2 * Math.PI);

  // > 0 is land: a round island with a ragged coast, and a few rocks off it.
  const land = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const [x, y] = [xOf(n), yOf(n)];
    const d = Math.hypot(x, y) / half;
    land[n] = 0.82 - d * d + (coast(x, y, 7) - 0.5) * 0.45;
  }
  if (size >= 48)
    for (const angle of isletAngles) {
      const [x0, y0] = [Math.cos(angle) * half * 0.93, Math.sin(angle) * half * 0.93];
      const spot: number[] = [];
      for (let n = 0; n < N; n++) if (Math.hypot(xOf(n) - x0, yOf(n) - y0) < 1.6 + coast(x0, y0, 3)) spot.push(n);
      // Only out at sea, clear of the coast.
      const clear = spot.every((n) => land[n]! <= 0 && [-2, -1, 0, 1, 2].every((dj) => [-2, -1, 0, 1, 2].every((di) => (land[n + dj * size + di] ?? 0) <= 0 || spot.includes(n + dj * size + di))));
      if (clear && spot.length) for (const n of spot) land[n] = 0.05;
    }
  const sea = (n: number) => land[n]! <= 0;
  // How many steps each cell is from the sea.
  const shore = new Int32Array(N).fill(-1);
  const front: number[] = [];
  for (let n = 0; n < N; n++) if (sea(n)) front.push(n), (shore[n] = 0);
  for (let head = 0; head < front.length; head++) {
    const n = front[head]!;
    for (let e = 0; e < 4; e++) {
      const m = near(n, e);
      if (m < 0 || shore[m] !== -1) continue;
      shore[m] = shore[n]! + 1;
      front.push(m);
    }
  }

  // The mountain: a cone pushed out of shape, in terraces up to its top.
  // On a small island it still has room for a snowy top, and keeps out of the village.
  const peakR = Math.max(6, peakSize * half);
  const away = Math.max(peakAway * half, VILLAGE * Math.SQRT2 + 2 + peakR * 0.6);
  const peak = { x: Math.cos(mountainAngle) * away, y: Math.sin(mountainAngle) * away, r: peakR };
  const top = Math.min(MAX_PEAK, Math.max(2, Math.round(peak.r / 2.6)));
  const mountain = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const [x, y] = [xOf(n), yOf(n)];
    const wx = x + (warp(x, y, 9) - 0.5) * peak.r * 0.45;
    const wy = y + (warp(y + 101, x - 57, 9) - 0.5) * peak.r * 0.45;
    mountain[n] = Math.max(0, 1 - Math.hypot(wx - peak.x, wy - peak.y) / peak.r) * (top + 0.9);
  }
  // How dry and how wet each spot is, -1 to 1: the side it's on, blurred by noise.
  const leaning = (n: number, angle: number, salt: number) => {
    const [x, y] = [xOf(n), yOf(n)];
    const out = Math.min(1, Math.hypot(x, y) / (0.3 * half));
    return Math.cos(Math.atan2(y, x) - angle) * out + (dryNoise(x + salt, y - salt, 10) - 0.5) * 0.9;
  };
  const dry = Float64Array.from({ length: N }, (_, n) => leaning(n, dryAngle, 0));
  const wet = Float64Array.from({ length: N }, (_, n) => leaning(n, wetAngle, 400));
  const isDesert = (n: number) => dry[n]! > 0.72 && mountain[n]! < 0.5;

  // Heights: the mountain, and rolling hills (mesas on the dry side) everywhere but the village and the beach.
  const h = new Int32Array(N);
  for (let n = 0; n < N; n++) {
    if (sea(n) || (land[n]! < 0.1 && mountain[n]! < 1)) continue;
    const v = hills(xOf(n), yOf(n), 11);
    const hill = v > hillLine + 0.13 ? 2 : v > hillLine ? 1 : 0;
    let height = Math.max(Math.floor(mountain[n]!), hill);
    // Where the mountain meets the sea it ends in a cliff; elsewhere the land comes down to a beach.
    if (mountain[n]! < 1) height = Math.min(height, Math.max(0, shore[n]! - 3));
    if (inVillage(n, 2)) height = 0;
    h[n] = height;
  }
  // `fixed` cells keep their height (the river and the lakes, once they're laid, and their banks).
  const fixed = new Uint8Array(N);
  /** No step between two cells of land is more than a block: a cliff that
   * high would cut the island up. Where one is, the higher side comes down,
   * unless it's fixed: then the lower side comes up, a bank along the river. */
  const settle = () => {
    for (let changed = true; changed; ) {
      changed = false;
      for (let n = 0; n < N; n++) {
        if (sea(n)) continue;
        // Once raised for a bank, a cell is fixed too.
        for (let e = 0; e < 4 && !fixed[n]; e++) {
          const m = near(n, e);
          if (m < 0 || sea(m)) continue;
          if (h[n]! > h[m]! + 1) h[n] = h[m]! + 1;
          else if (fixed[m] && h[n]! < h[m]! - 1) {
            h[n] = h[m]! - 1;
            fixed[n] = 1;
          } else continue;
          changed = true;
        }
      }
    }
  };
  settle();
  // No lone spikes or pits: a block that stands out on its own, or a hole, is levelled.
  for (let pass = 0; pass < 3; pass++)
    for (let n = 0; n < N; n++) {
      if (sea(n)) continue;
      let higher = 0;
      let level = 0;
      let lower = 0;
      for (let e = 0; e < 4; e++) {
        const m = near(n, e);
        if (m < 0 || sea(m)) continue;
        if (h[m]! > h[n]!) higher++;
        else if (h[m] === h[n]) level++;
        else lower++;
      }
      if (h[n]! > 0 && higher + level < 2) h[n]!--;
      else if (higher >= 3 && !lower) h[n]!++;
    }
  settle();

  const cells: IslandCell[] = Array.from({ length: N }, () => ({ ground: "grass" }));
  const layout: IslandLayout = { size, cells };
  const ground = (n: number) => cells[n]!.ground;

  // A frozen tarn on the top: the highest two by two cells that are level,
  // nearest the peak, with level ground beside it for the river to leave by.
  let tarn = -1;
  for (let level = top, best = Infinity; level > 0 && tarn < 0; level--)
    for (let n = size + 1; n < N; n++) {
      if (iOf(n) === 0) continue;
      const block = [n - size - 1, n - size, n - 1, n];
      const far = Math.hypot(xOf(n) - 0.5 - peak.x, yOf(n) - 0.5 - peak.y);
      if (far >= best || !block.every((m) => h[m] === level && !sea(m))) continue;
      const outlet = block.some((m) => EDGES.some((_, e) => near(m, e) >= 0 && !block.includes(near(m, e)) && h[near(m, e)] === level && !sea(near(m, e)) && shore[near(m, e)]! > 1));
      if (outlet) [best, tarn] = [far, n];
    }
  const tarnCells = tarn < 0 ? [] : [tarn - size - 1, tarn - size, tarn - 1, tarn];
  for (const n of tarnCells) cells[n]!.ground = "ice";

  // The river: from the tarn down to the sea on the wet side, the easiest
  // way down by way of a few bends, never climbing nor running alongside itself.
  const mouth = coastAt(wetAngle + side * 0.1);
  const atMouth = (n: number) => within(mouth, 4)(n) && EDGES.some((_, e) => near(n, e) >= 0 && sea(near(n, e)));
  const springs = tarnCells.flatMap((t) => EDGES.map((_, e) => near(t, e)).filter((m) => m >= 0 && ground(m) !== "ice" && h[m] === h[t] && !sea(m)));
  const taken = new Uint8Array(N);
  const seaward = tarnCells.length ? [iOf(mouth) - iOf(tarnCells[0]!), jOf(mouth) - jOf(tarnCells[0]!)].map((v, _, [a, b]) => v / Math.hypot(a!, b!)) : [0, 0];
  const flows = (n: number, m: number, e: number, came: number) => {
    // Not along the shore, but where it comes out.
    if (sea(m) || ground(m) === "ice" || inVillage(m, size >= 48 ? 3 : 1) || taken[m] || (shore[m]! <= 1 && !within(mouth, 5)(m))) return null;
    for (let k = 0; k < 4; k++) {
      const o = near(m, k);
      if (o >= 0 && o !== n && taken[o]) return null;
    }
    const [x, y] = [xOf(m), yOf(m)];
    // Down the valleys: low ground is cheap, high ground dear, and the noise bends it this way and that.
    const lie = hills(x, y, 11) ** 2 * 3 + meander(x, y, 8) ** 2 * 3;
    // Onwards to the sea: a step back towards the source costs more.
    const back = Math.max(0, -(EDGES[e]![1] * seaward[0] + EDGES[e]![2] * seaward[1]));
    return 0.4 + Math.max(0, h[m]! - h[n]!) * 30 + h[m]! * 2.5 + lie + back * 1.5 + (came !== START && e !== came ? 0.5 : 0) + (shore[m]! <= 3 ? 6 / shore[m]! : 0);
  };
  const lay = (stops: number[]) => {
    const way: number[] = [];
    taken.fill(0);
    for (const [k, stop] of stops.entries()) {
      const last = k === stops.length - 1;
      const leg = cheapestWay(size, way.length ? [way[way.length - 1]!] : springs, last ? atMouth : within(stop, 2), flows, headingOf(way));
      if (!leg) {
        if (last) return null;
        continue;
      }
      for (const n of way.length ? leg.slice(1) : leg) {
        way.push(n);
        taken[n] = 1;
      }
    }
    return way;
  };
  // Its bends keep clear of the village.
  const course = (tarnCells.length && (lay([...bends(tarnCells[0]!, mouth, 3, 0.15, look).filter((p) => !inVillage(p, 8)), mouth]) ?? lay([mouth]))) || [];
  // A waterfall only down a straight stretch: the river drops a block where
  // the land does and it runs straight on, carving its way where it can't.
  const straight = (k: number) => k > 0 && k + 1 < course.length && course[k]! - course[k - 1]! === course[k + 1]! - course[k]!;
  for (let k = 0, level = h[course[0] ?? 0]!; k < course.length; k++) {
    const n = course[k]!;
    // Down to the sea's level by the end, whatever the land does.
    const left = course.length - 1 - k;
    if (k > 0 && level > 0 && (h[n]! < level || left <= level) && straight(k) && h[course[k - 1]!] === level && (k < 2 || h[course[k - 2]!] === level)) level--;
    h[n] = level;
    fixed[n] = 1;
    cells[n]!.ground = "river";
  }
  settle();

  // Still water: a lake on the river in the woods, a pond in the meadows and, on a big enough island, an oasis in the desert.
  const pool = (centre: number, r: number, onRiver: boolean) => {
    const level = h[centre]!;
    const [x0, y0] = [xOf(centre), yOf(centre)];
    const pooled: number[] = [];
    for (let n = 0; n < N; n++) {
      const d = Math.hypot(xOf(n) - x0, yOf(n) - y0) / (r * (0.8 + 0.5 * coast(xOf(n), yOf(n), 3)));
      if (d > 1 || sea(n) || inVillage(n, 2) || h[n] !== level || ground(n) === "ice" || (!onRiver && ground(n) === "river")) continue;
      cells[n]!.ground = "water";
      fixed[n] = 1;
      pooled.push(n);
    }
    return pooled;
  };
  // The lake: on the river where it's come down to the lowlands, well before the sea.
  const lakeAt = course.findIndex((n, k) => k >= course.length * 0.45 && h[n] === 0 && shore[n]! >= 6 && course.length - k > 8 && !inVillage(n, 6));
  const lake = lakeAt >= 0 ? pool(course[lakeAt]!, Math.max(2, 0.05 * size), true) : [];
  const pondAt = (angle: number, away: number) => {
    const n = Math.floor(half + Math.sin(angle) * away * half) * size + Math.floor(half + Math.cos(angle) * away * half);
    return sea(n) || ground(n) !== "grass" ? -1 : n;
  };
  const pondCentre = pondAt(frontAngle + (look() - 0.5) * 0.8, 0.45 + look() * 0.15);
  if (pondCentre >= 0) pool(pondCentre, Math.max(1.5, 0.035 * size), false);
  const oasisCentre = size >= 40 ? pondAt(dryAngle + (look() - 0.5) * 0.5, 0.5 + look() * 0.1) : -1;
  const oasis = oasisCentre >= 0 ? pool(oasisCentre, Math.max(1.2, 0.022 * size), false) : [];
  settle();

  // Ground: snow at the top of the mountain, bare earth here and there on its
  // shoulders, sand on the beach and in the desert, grass everywhere else.
  const snowline = Math.max(2, top - Math.floor(top / 3));
  const beach = (n: number) => land[n]! < 0.08 && !h[n];
  for (let n = 0; n < N; n++) {
    const c = cells[n]!;
    if (sea(n)) c.ground = "water";
    else if (c.ground !== "grass") {
      // The river, the lakes and the tarn are laid already.
    } else if (mountain[n]! >= 1 && h[n]! >= snowline) c.ground = "snow";
    else if (mountain[n]! >= 1 && h[n]! >= Math.max(2, snowline - 2) && scree(xOf(n), yOf(n), 4) > 0.6) c.ground = "dirt";
    else if (beach(n) || (isDesert(n) && !inVillage(n, 1))) c.ground = "sand";
    if (h[n]) c.height = h[n];
  }
  const isWater = (g: Ground) => g === "water" || g === "river" || g === "ice";

  // The village: a green inside a ring road.
  for (let n = 0; n < N; n++) if (inVillage(n)) cells[n]!.ground = chebyshev(n, mid, mid) === VILLAGE ? "road" : "grass";

  /*
   * Roads, from the village (or a road already laid) to each place worth
   * going: the tarn, the beach in front, the lake, the oasis. Each takes the
   * easy way: round the hills where that isn't far, up them on a slope where
   * it is, straight on where it can, and over the river on a culvert.
   */
  const roads = new Set<number>();
  for (let n = 0; n < N; n++) if (ground(n) === "road") roads.add(n);
  const ramps = new Set<number>();
  // The edge a ramp on `n` would climb by: towards its first neighbour a block up (see rampDirection).
  const climbsBy = (n: number) => EDGES.findIndex((_, e) => near(n, e) >= 0 && h[near(n, e)]! === h[n]! + 1);
  const riverAcross = (m: number, e: number) => {
    // A culvert takes the river straight under the road, the road straight over the river.
    const [a, b] = [near(m, (e + 1) % 4), near(m, (e + 3) % 4)];
    const beyond = near(m, e);
    return a >= 0 && b >= 0 && beyond >= 0 && ground(a) === "river" && ground(b) === "river" && h[a] === h[m] && h[b] === h[m] && !isWater(ground(beyond)) && h[beyond] === h[m];
  };
  const paves = (n: number, m: number, e: number, came: number) => {
    const g = ground(m);
    if (sea(m) || g === "water" || g === "ice") return null;
    if (g === "river" && (h[m] !== h[n] || !riverAcross(m, e) || (came !== START && came !== e))) return null;
    const back = came === START ? -1 : near(n, OPPOSITE[came]!);
    // Off a slope or a culvert, straight on.
    if (came !== START && (ground(n) === "river" || h[back]! !== h[n]) && e !== came) return null;
    const dh = h[m]! - h[n]!;
    if (Math.abs(dh) > 1) return null;
    if (dh) {
      // Up or down a slope: walked straight, from level ground, and the slope has to face the right way.
      if (came === START || e !== came || h[back]! !== h[n] || g === "river" || ground(n) === "river") return null;
      if (dh > 0 ? climbsBy(n) !== e : climbsBy(m) !== OPPOSITE[e]) return null;
    }
    // Not hugging another road, nor the river's bank.
    let crowded = 0;
    for (let k = 0; k < 4; k++) {
      const o = near(m, k);
      if (o >= 0 && o !== n && (roads.has(o) || (g !== "river" && ground(o) === "river"))) crowded++;
    }
    return 1 + (came !== START && e !== came ? 2 : 0) + (dh ? 3 : 0) + (g === "river" ? 4 : 0) + crowded * 3 + Math.max(0, rough(xOf(m), yOf(m), 7) - 0.45) * 5;
  };
  /** A road to `target`'s `goal`, by way of a bend; returns its cells. */
  const road = (target: number, goal: (n: number) => boolean) => {
    const starts = [...roads].filter((n) => !ramps.has(n) && ground(n) === "road");
    const [bend] = bends(home, target, 1, 0.22, rng);
    const first = bend === undefined ? null : cheapestWay(size, starts, within(bend, 2), paves);
    const way = first ? first.concat(cheapestWay(size, [first[first.length - 1]!], goal, paves, headingOf(first))?.slice(1) ?? []) : cheapestWay(size, starts, goal, paves);
    if (!way || !goal(way[way.length - 1]!)) return [];
    for (let k = 1; k < way.length; k++) {
      const [a, b] = [way[k - 1]!, way[k]!];
      if (h[b]! > h[a]!) ramps.add(a);
      if (h[b]! < h[a]!) ramps.add(b);
    }
    for (const n of way) {
      cells[n]!.ground = "road";
      roads.add(n);
    }
    return way;
  };
  const touching = (pool: number[]) => {
    const wanted = new Set<number>();
    for (const p of pool) for (let e = 0; e < 4; e++) if (near(p, e) >= 0) wanted.add(near(p, e));
    return (n: number) => wanted.has(n) && ground(n) !== "water" && ground(n) !== "ice";
  };
  const harbour = coastAt(frontAngle);
  const avenue = road(harbour, (n) => beach(n) && within(harbour, 3)(n));
  if (tarnCells.length) road(tarn, touching(tarnCells));
  if (lake.length) road(lake[0]!, touching(lake));
  if (oasis.length) road(oasis[0]!, touching(oasis));
  for (const n of ramps) cells[n]!.ramp = true;

  // Down by the sea the river widens: the last stretch gets a twin alongside.
  const twins = new Map<number, number>();
  for (let k = Math.max(1, course.length - 6); k < course.length - 1; k++) {
    const [prev, n, next] = [course[k - 1]!, course[k]!, course[k + 1]!];
    if (n - prev !== next - n || ground(n) !== "river") continue;
    // Across the flow: along i when it runs along j, and the other way round.
    const twin = Math.abs(n - prev) === size ? n + 1 : n + size;
    if (iOf(twin) === 0 || twin >= N || !canHoldDecor(ground(twin)) || h[twin] !== h[n]) continue;
    cells[twin]!.ground = "river";
    twins.set(k, twin);
  }

  // Footbridges, only across a straight stretch onto level land on both
  // banks: every so often, and one broad one across the mouth.
  let sinceBridge = BRIDGE_EVERY;
  let broad = false;
  course.forEach((n, k) => {
    sinceBridge++;
    if (ground(n) !== "river") return;
    const [prev, next] = [course[k - 1], course[k + 1]];
    if (prev === undefined || next === undefined || n - prev !== next - n) return;
    const across = Math.abs(n - prev) === size ? 1 : size;
    const twin = twins.get(k);
    const reach = twin === undefined ? 1 : 2;
    const level = (b: number) => b >= 0 && b < N && (canHoldDecor(ground(b)) || ground(b) === "road") && h[b] === h[n] && !ramps.has(b);
    if (!level(n - across) || !level(n + across * reach)) return;
    if (twin !== undefined ? broad : sinceBridge < BRIDGE_EVERY) return;
    cells[n]!.bridge = true;
    if (twin !== undefined) {
      cells[twin]!.bridge = true;
      broad = true;
    }
    sinceBridge = 0;
  });

  // Waterfalls come down between slopes, as the pack draws them: the land
  // either side of one slopes up the same way where it can.
  for (const n of course) {
    if (ground(n) !== "river") continue;
    const up = EDGES.findIndex((_, e) => near(n, e) >= 0 && ground(near(n, e)) === "river" && h[near(n, e)] === h[n]! + 1);
    if (up < 0) continue;
    for (const s of [(up + 1) % 4, (up + 3) % 4]) {
      const beside = near(n, s);
      const c = cells[beside];
      if (c && canRamp(c.ground) && c.ground !== "river" && c.ground !== "road" && h[beside] === h[n] && near(beside, up) >= 0 && h[near(beside, up)] === h[n]! + 1) c.ramp = true;
    }
  }

  // Slopes: keep adding one where a reachable cell meets an unreachable one a
  // block up or down, until everything that can be reached is; then a few
  // more along the cliffs, so nobody goes the long way round every hill.
  // Asked for again after every slope: one pair of buffers for every walk, not a new one each time.
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
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
  // A slope can go on `n` (bare earth turns to grass for it), climbing to its
  // first neighbour a block up, which isn't river; `straight`: that's its only one.
  const slopeFits = (n: number, straight: boolean) => {
    const c = cells[n]!;
    if (c.ramp || c.decor || c.bridge || !(canRamp(c.ground) || c.ground === "dirt") || c.ground === "river" || c.ground === "road") return -1;
    const e = climbsBy(n);
    if (e < 0 || ground(near(n, e)) === "river" || cells[near(n, e)]!.ramp) return -1;
    if (straight && EDGES.some((_, k) => k !== e && near(n, k) >= 0 && h[near(n, k)]! > h[n]!)) return -1;
    // Its foot is open ground, at its own level.
    const foot = near(n, OPPOSITE[e]!);
    if (foot < 0 || h[foot] !== h[n] || isWater(ground(foot)) || cells[foot]!.ramp) return -1;
    return e;
  };
  const slope = (n: number) => {
    const c = cells[n]!;
    if (c.ground === "dirt") c.ground = "grass";
    c.ramp = true;
  };
  for (let guard = 0; guard < N; guard++) {
    reachable();
    const linking = (straight: boolean) => {
      const found: number[] = [];
      for (let n = 0; n < N; n++) {
        const e = slopeFits(n, straight);
        if (e >= 0 && seen[near(n, e)] !== seen[n]) found.push(n);
      }
      return found;
    };
    const straightOnes = linking(true);
    const candidates = straightOnes.length ? straightOnes : linking(false);
    if (!candidates.length) break;
    slope(pick(candidates));
  }
  const spare = Array.from({ length: N }, (_, n) => n).filter((n) => slopeFits(n, true) >= 0);
  for (let k = spare.length - 1; k > 0; k--) {
    const r = Math.floor(rng() * (k + 1));
    [spare[k], spare[r]] = [spare[r]!, spare[k]!];
  }
  const slopes: number[] = [];
  for (let n = 0; n < N; n++) if (cells[n]!.ramp) slopes.push(n);
  for (const n of spare) {
    if (slopes.some((s) => chebyshev(s, iOf(n), jOf(n)) < RAMP_SPACING) || slopeFits(n, true) < 0) continue;
    slope(n);
    slopes.push(n);
  }

  // Decor. A cell no one can reach gets something standing on it so nobody is
  // sent there; the rest, by where it is: woods on the wet side, groves in
  // the meadows, pines and rocks up the mountain, cacti in the desert, bushes
  // along the water, poplars down the road to the beach.
  reachable();
  const lined = new Set<number>();
  for (let k = 1; k + 1 < avenue.length; k++) {
    const [prev, n, next] = [avenue[k - 1]!, avenue[k]!, avenue[k + 1]!];
    if (n - prev !== next - n || inVillage(n, 2) || k % 3) continue;
    const across = Math.abs(n - prev) === size ? 1 : size;
    for (const s of [n - across, n + across]) if (s >= 0 && s < N && Math.abs(iOf(s) - iOf(n)) <= 1) lined.add(s);
  }
  const wetBy = (n: number) => EDGES.some((_, e) => near(n, e) >= 0 && (ground(near(n, e)) === "river" || (ground(near(n, e)) === "water" && !sea(near(n, e)))));
  const cliffBehind = (n: number) => EDGES.some((_, e) => near(n, e) >= 0 && h[near(n, e)]! > h[n]! && !cells[near(n, e)]!.ramp);
  const oasisNear = (n: number) => oasis.some((o) => Math.hypot(iOf(o) - iOf(n), jOf(o) - jOf(n)) <= 2.5);
  for (let n = 0; n < N; n++) {
    const c = cells[n]!;
    if (c.ramp || !canHoldDecor(c.ground)) continue;
    if (!seen[n]) {
      c.decor = c.ground === "snow" ? pick(SNOW_TREES) : c.ground === "sand" ? pick(SAND_ROCKS) : c.ground === "dirt" ? pick(DIRT_ROCKS) : rng() < 0.5 ? pick(ROCKS) : pick(PINES);
      continue;
    }
    // Keep the village and the foot of every slope clear, but for a poplar at each corner of the green.
    if (inVillage(n, 1) && Math.abs(iOf(n) - mid) === VILLAGE + 1 && Math.abs(jOf(n) - mid) === VILLAGE + 1 && c.ground === "grass") c.decor = pick(POPLARS);
    if (inVillage(n, 1) || EDGES.some((_, e) => near(n, e) >= 0 && cells[near(n, e)]!.ramp)) continue;
    const [x, y] = [xOf(n), yOf(n)];
    const r = rng();
    const grove = woods(x, y, 6);
    const high = mountain[n]! >= 1;
    let decor: DecorKind | undefined;
    if (lined.has(n) && c.ground === "grass" && !roads.has(n)) decor = pick(POPLARS);
    else if (c.ground === "snow") decor = r < (grove > 0.5 ? 0.22 : 0.05) ? pick(SNOW_TREES) : r < 0.3 && r > 0.25 ? pick(SNOW_BUSHES) : undefined;
    else if (c.ground === "dirt") decor = r < 0.14 ? pick(DIRT_ROCKS) : r < 0.2 ? pick(PINES) : undefined;
    else if (beach(n)) decor = r < 0.025 ? pick(SAND_ROCKS) : undefined;
    else if (c.ground === "sand") {
      if (oasisNear(n)) decor = r < 0.45 ? pick(ROUND_TREES) : r < 0.7 ? pick(BUSHES) : undefined;
      else decor = r < (grove > 0.55 ? 0.12 : 0.025) ? pick(CACTI) : r > 0.96 || (cliffBehind(n) && r > 0.88) ? pick(SAND_ROCKS) : undefined;
    } else if (high) decor = r < (grove > 0.45 ? 0.38 : 0.07) ? pick(PINES) : r > 0.95 || (cliffBehind(n) && r > 0.88) ? pick(ROCKS) : r > 0.92 ? pick(BUSHES) : undefined;
    else {
      // The woods: thick where it's wet, thinning out at their edges.
      const thick = clamp01((wet[n]! - 0.15) * 2) * clamp01((grove - 0.38) * 5);
      const meadowGrove = clamp01((grove - 0.66) * 6) * 0.35;
      const trees = Math.max(thick * 0.65, meadowGrove);
      if (r < trees) decor = h[n]! >= 1 && rng() < 0.4 ? pick(PINES) : rng() < 0.12 ? pick(POPLARS) : pick(ROUND_TREES);
      else if (r < trees + (thick > 0 || wetBy(n) ? 0.1 : 0.025)) decor = pick(BUSHES);
      else if (r > 0.993 || (cliffBehind(n) && r > 0.96)) decor = pick(ROCKS);
      else if (r > 0.985) decor = rng() < 0.5 ? pick(ROUND_TREES) : pick(POPLARS);
    }
    if (decor) c.decor = decor;
  }

  // Nests, each two cells wide on a flat clearing: one in the middle of the
  // village, the others scattered out from it, a few blobs to each.
  const want = Math.max(1, Math.round((size / 6) ** 2 / PER_NEST));
  // The 4x4 cells around the corner (i, j) a nest sits on: all level, open ground.
  const clearing = (i: number, j: number) => {
    const around: IslandCell[] = [];
    for (let b = j - 2; b < j + 2; b++)
      for (let a = i - 2; a < i + 2; a++) {
        const c = cellAt(layout, a, b);
        if (!c || !seen[b * size + a] || c.height || c.ramp || !canHoldDecor(c.ground)) return null;
        around.push(c);
      }
    return around;
  };
  const spots: { i: number; j: number; score: number }[] = [];
  for (let n = 0; n < N; n++) {
    const [i, j] = [iOf(n), jOf(n)];
    // Out from the village, give or take: a nest by a road or a tree rather than out in a row.
    if (clearing(i, j)) spots.push({ i, j, score: i === mid && j === mid ? -1 : Math.hypot(i - mid, j - mid) * 0.5 + rng() * size * 0.25 });
  }
  spots.sort((p, q) => p.score - q.score);
  const nests: { i: number; j: number }[] = [];
  for (const spot of spots) if (nests.length < want && nests.every((o) => Math.hypot(o.i - spot.i, o.j - spot.j) >= NEST_SPACING)) nests.push(spot);
  for (const { i, j } of nests) for (const c of clearing(i, j) ?? []) delete c.decor;
  return { size, cells, nests: nests.map(({ i, j }) => ({ x: i / size, y: j / size, r: 1 / size })) };
}
