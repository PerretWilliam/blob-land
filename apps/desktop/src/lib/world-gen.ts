import { seededRng } from "@blob-land/sim";
import { canHoldDecor, canRamp, canStep, cellAt, EDGES, type DecorKind, type IslandCell, type IslandLayout } from "./island";

/*
 * The public garden: one procedural island, the same on every client (it's
 * a pure function of its size, which the server sends — see gardenSize), so
 * nothing about the terrain is stored or sent. An ocean all round, a beach,
 * plains and woods with rolling hills, a small desert, a mountain with a snowy
 * top, a river from a frozen tarn down waterfalls to the sea, with footbridges,
 * culverts and a wide mouth, and a village clearing in the middle. Blobs
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
  // The plains' low hills, by cell: their sides slope all round.
  const knolls = new Set<number>();
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
      if (height === 0 && l > 0.3 && hills(x + 90, y, 5) > 0.72) {
        height = 1;
        knolls.add(cells.length);
      }
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
  // Four roads out of it, through grass and sand, until they meet water or a
  // slope, each with one jog sideways on the way: a bend each way.
  const mid = Math.floor(half);
  const pave = (i: number, j: number) => {
    const c = at(i, j);
    if (!c || (c.ground !== "grass" && c.ground !== "sand") || c.height) return false;
    c.ground = "road";
    return true;
  };
  for (const [, di, dj] of EDGES) {
    let [i, j] = [mid + di, mid + dj];
    for (let k = 2; k < VILLAGE + Math.max(12, size / 3); k++) {
      [i, j] = [i + di, j + dj];
      if (!pave(i, j)) break;
      if (k === VILLAGE + 4) {
        [i, j] = [i + dj, j + di];
        if (!pave(i, j)) break;
      }
    }
  }

  // A river from a frozen tarn high on the mountain down to the sea. It
  // keeps to the ground, falling a block at a time as waterfalls (a river
  // falls on its own, see rampDirection), and meanders but always heads out.
  // The tarn is on the mountain's flank on the screen's left, well clear of the village.
  let [ri, rj] = [Math.round(half + peak.x), Math.round(half + peak.y + peak.r * 0.45)];
  const tarn = at(ri, rj - 1);
  if (tarn?.height) tarn.ground = "ice";
  // Its cells in order, with whether a road ran there before it.
  const course: { i: number; j: number; road: boolean }[] = [];
  const sea = (i: number, j: number) => land[j * size + i]! <= 0;
  // After a fall or a road the river runs straight on, so the waterfall or the
  // culvert opens at both ends.
  let fell = null as readonly [number, number] | null;
  for (let steps = 0; steps < size * 2; steps++) {
    const c = at(ri, rj);
    if (!c || sea(ri, rj)) break;
    const h = c.height ?? 0;
    // It runs on through any lake it meets.
    if (c.ground !== "water") {
      course.push({ i: ri, j: rj, road: c.ground === "road" });
      c.ground = "river";
    }
    const out = Math.hypot(...centred(ri, rj));
    const options = neighbours(ri, rj).filter(([a, b]) => {
      const n = at(a, b);
      const nh = n?.height ?? 0;
      // Downhill or level; through a low hill of the plains, it cuts its way.
      const fits = (nh <= h && nh >= h - 1) || (nh === h + 1 && knolls.has(b * size + a));
      return n && (n.ground === "water" || (fits && n.ground !== "river" && n.ground !== "ice" && !inVillage(a, b, 2)));
    });
    if (!options.length) break;
    // Mostly towards the front of the island, drifting outwards and now and
    // then sideways; straight into the sea when it's next door.
    const ahead: readonly [number, number] | null = fell;
    const score = ([a, b]: readonly [number, number]): number =>
      (sea(a, b) ? 9 : b - rj + 0.5 * (Math.hypot(...centred(a, b)) - out) + rng() * 1.4) + (ahead && a - ri === ahead[0] && b - rj === ahead[1] ? 20 : 0);
    const [ni, nj]: readonly [number, number] = options.reduce((best: readonly [number, number], o) => (score(o) > score(best) ? o : best));
    const next = at(ni, nj)!;
    if ((next.height ?? 0) > h) {
      if (h) next.height = h;
      else delete next.height;
    }
    // Over a fall, or under a road, it carries straight on.
    fell = (next.height ?? 0) < h || next.ground === "road" ? [ni - ri, nj - rj] : null;
    [ri, rj] = [ni, nj];
  }

  // Down by the sea it widens: the last stretch gets a twin alongside.
  const twins = new Map<number, number>();
  for (let k = Math.max(1, course.length - 7); k < course.length - 1; k++) {
    const [prev, { i, j }, next] = [course[k - 1]!, course[k]!, course[k + 1]!];
    if (prev.i !== next.i && prev.j !== next.j) continue;
    // Beside the flow, always on the same side.
    const [di, dj] = prev.i === next.i ? [1, 0] : [0, 1];
    const twin = at(i + di, j + dj);
    if (!twin || !canHoldDecor(twin.ground) || (twin.height ?? 0) !== (at(i, j)!.height ?? 0)) continue;
    twin.ground = "river";
    twins.set(k, (j + dj) * size + i + di);
  }

  // A lane from the village down to the river, across it over a culvert and
  // on a little way: the shortest way over flat open land to the nearest
  // straight stretch with a level bank either side.
  const flat = (c: IslandCell | undefined) => c && (c.ground === "grass" || c.ground === "sand" || c.ground === "road") && !c.height;
  const from = new Int32Array(size * size).fill(-2);
  const dist = new Int32Array(size * size);
  const lanes = [mid * size + mid];
  from[mid * size + mid] = -1;
  for (let head = 0; head < lanes.length; head++) {
    const n = lanes[head]!;
    for (const [a, b] of neighbours(n % size, Math.floor(n / size))) {
      const m = b * size + a;
      if (a < 0 || b < 0 || a >= size || b >= size || from[m] !== -2 || !flat(cells[m])) continue;
      from[m] = n;
      dist[m] = dist[n]! + 1;
      lanes.push(m);
    }
  }
  let lane: { k: number; bank: number; di: number; dj: number } | null = null;
  course.forEach(({ i, j }, k) => {
    const [prev, next] = [course[k - 1], course[k + 1]];
    if (!prev || !next || twins.has(k) || (prev.i !== next.i && prev.j !== next.j) || at(i, j)!.height) return;
    const [di, dj] = prev.i === next.i ? [1, 0] : [0, 1];
    for (const side of [-1, 1]) {
      const [near, far] = [at(i + di * side, j + dj * side), at(i - di * side, j - dj * side)];
      const bank = (j + dj * side) * size + i + di * side;
      if (!flat(near) || !flat(far) || from[bank] === -2) continue;
      if (!lane || dist[bank]! < dist[lane.bank]!) lane = { k, bank, di: -di * side, dj: -dj * side };
    }
  });
  if (lane) {
    const { k, bank, di, dj } = lane as { k: number; bank: number; di: number; dj: number };
    // Back to the village one step nearer at a time, turning as little as it can.
    let [m, step] = [bank, -1];
    while (dist[m]! > 0) {
      cells[m]!.ground = "road";
      const [i, j] = [m % size, Math.floor(m / size)];
      const nearer = neighbours(i, j)
        .filter(([a, b]) => a >= 0 && b >= 0 && a < size && b < size)
        .map(([a, b]) => b * size + a)
        .filter((o) => from[o] !== -2 && dist[o] === dist[m]! - 1);
      const next = nearer.find((o) => o - m === step) ?? nearer[0]!;
      [step, m] = [next - m, next];
    }
    let [i, j] = [course[k]!.i, course[k]!.j];
    at(i, j)!.ground = "road";
    for (let step = 0; step < 6; step++) {
      [i, j] = [i + di, j + dj];
      if (!flat(at(i, j))) break;
      at(i, j)!.ground = "road";
    }
  }

  // Bridges, only across a straight stretch onto level land on both banks:
  // every so often a footbridge, and one broad one across the estuary. Where
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

  // The plains' low hills slope all round, round their corners too.
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const c = at(i, j)!;
      if (c.height || c.ramp || c.ground === "road" || c.ground === "river" || !canRamp(c.ground) || inVillage(i, j, 1)) continue;
      let near = false;
      for (let b = j - 1; b <= j + 1; b++) for (let a = i - 1; a <= i + 1; a++) if (knolls.has(b * size + a) && at(a, b)?.height === 1) near = true;
      if (near) c.ramp = true;
    }

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

