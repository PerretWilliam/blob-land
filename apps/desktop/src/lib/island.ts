import { NEST, type GroundPoint } from "@blob-land/sim";
import { exists, mkdir, readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";

/*
 * Everything the editor can place, grouped the way its toolbar shows them.
 * Ids are the sprite file names in assets/iso (family-variant-n, from the pack).
 */
export const DECOR_CATEGORIES = {
  trees: ["tree-1", "tree-2", "tree-3", "tree-4", "tree-5", "tree-6", "tree-snow-1", "tree-snow-2", "tree-snow-3", "tree-snow-4", "tree-snow-5", "tree-snow-6"],
  bushes: ["bush-1", "bush-2", "bush-3", "bush-4", "bush-snow-1", "bush-snow-2", "bush-snow-3", "bush-snow-4"],
  rocks: ["rock-1", "rock-2", "rock-3", "rock-4", "rock-5", "rock-6", "rock-7", "rock-8", "rock-dirt-1", "rock-dirt-2", "rock-dirt-3", "rock-dirt-4", "rock-dirt-5", "rock-dirt-6", "rock-dirt-7", "rock-dirt-8", "rock-sand-1", "rock-sand-2", "rock-sand-3", "rock-sand-4", "rock-sand-5", "rock-sand-6", "rock-sand-7", "rock-sand-8"],
  cacti: ["cactus-1", "cactus-2", "cactus-3", "cactus-4", "cactus-5"],
} as const;
export type DecorCategory = keyof typeof DECOR_CATEGORIES;
export type DecorKind = (typeof DECOR_CATEGORIES)[DecorCategory][number];
export const DECOR_KINDS: readonly DecorKind[] = Object.values(DECOR_CATEGORIES).flat();

export const GROUNDS = ["grass", "sand", "dirt", "snow", "water", "ice", "road", "river"] as const;
export type Ground = (typeof GROUNDS)[number];
/** Grounds things can stand on: nothing grows in water, on ice or in the middle of a road or river. */
export const canHoldDecor = (ground: Ground) => ground === "grass" || ground === "sand" || ground === "dirt" || ground === "snow";
/** Grounds whose surface sits lower than the banks around them (a blob wades into them). */
export const isSunken = (ground: Ground) => ground === "water" || ground === "ice" || ground === "river";
/** Grounds the pack draws as a slope. Dirt has no ramp of its own, and still water lies flat. */
export const canRamp = (ground: Ground) => ground === "grass" || ground === "sand" || ground === "snow" || ground === "road" || ground === "river";
/** Grounds whose slopes the pack also draws round a corner (see `rampInside`, `rampOutside`). */
const turnsCorners = (ground: Ground) => ground === "grass" || ground === "sand" || ground === "snow";
/** How many blocks a cell can be stacked above the base level. */
export const MAX_HEIGHT = 2;

export interface IslandCell {
  ground: Ground;
  decor?: DecorKind;
  /** Blocks stacked above the base level, 0 (default) to MAX_HEIGHT. */
  height?: number;
  /** A slope up to the neighbours one block higher (see `rampDirection`, `rampInside`, `rampOutside`). */
  ramp?: true;
  /** On a river: a footbridge, straight across it. Walked over, never stopped on. */
  bridge?: true;
}

/**
 * A `size` x `size` walkable grid, row-major (`cells[j * size + i]`, i along
 * ground x, j along ground y). Local only: the private island a user edits.
 * The public garden always renders `defaultIsland`.
 */
export interface IslandLayout {
  size: number;
  cells: IslandCell[];
  /** Where blobs sleep, if not the sim's own NEST corner: the garden's
   * nests, each a square (centre, half side) in ground units. Every blob has
   * its own one (see `homeNest`). */
  nests?: { x: number; y: number; r: number }[];
}

export const ISLAND_SIZE = 4;
// Bounds on a private island's side, in cells. The file is user-writable too.
export const MIN_ISLAND_SIZE = 2;
export const MAX_ISLAND_SIZE = 16;

/** Grow or shrink from the far corners: the nest's (0, 0) corner keeps its
 * cells, and new ground comes in as bare grass. */
export function resizeIsland(island: IslandLayout, size: number): IslandLayout {
  size = Math.min(MAX_ISLAND_SIZE, Math.max(MIN_ISLAND_SIZE, size));
  if (size === island.size) return island;
  const cells = Array.from({ length: size * size }, (_, n): IslandCell => {
    const [i, j] = [n % size, Math.floor(n / size)];
    return cellAt(island, i, j) ?? { ground: "grass" };
  });
  // On a big island the nest can land on a different cell: keep it bare.
  cells[nestCell(size)] = { ground: "grass" };
  return { size, cells };
}

/** The cell the nest sits on. Kept grass and bare: it's where the blob sleeps. */
export function nestCell(size: number): number {
  const c = Math.floor(((NEST.min + NEST.max) / 2) * size);
  return c * size + c;
}

// Default decor, in ground coordinates so any island size gets a similar spread.
const DEFAULT_DECOR: [DecorKind, number, number][] = [
  ["tree-6", 0.9, 0.12],
  ["tree-4", 0.12, 0.9],
  ["rock-4", 0.78, 0.8],
  ["bush-3", 0.5, 0.35],
  ["tree-2", 0.55, 0.06],
  ["rock-2", 0.3, 0.62],
  ["bush-4", 0.08, 0.45],
];

export function defaultIsland(size: number): IslandLayout {
  const cells: IslandCell[] = Array.from({ length: size * size }, () => ({ ground: "grass" }));
  // Small islands only get the first few, so they don't read as cluttered.
  for (const [kind, x, y] of DEFAULT_DECOR.slice(0, size >= 5 ? undefined : 4)) {
    const cell = cells[Math.floor(y * size) * size + Math.floor(x * size)]!;
    cell.decor ??= kind;
  }
  return { size, cells };
}

/** The file is user-writable, so anything that isn't exactly this shape is
 * treated as absent rather than trusted. */
function parseIsland(value: unknown): IslandLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const { size, cells } = value as Partial<IslandLayout>;
  if (!Number.isInteger(size) || size! < MIN_ISLAND_SIZE || size! > MAX_ISLAND_SIZE) return null;
  if (!Array.isArray(cells) || cells.length !== size! * size!) return null;
  const parsed: IslandCell[] = [];
  for (const c of cells as unknown[]) {
    if (typeof c !== "object" || c === null) return null;
    const { ground, decor, height, ramp, bridge } = c as { ground?: unknown; decor?: unknown; height?: unknown; ramp?: unknown; bridge?: unknown };
    if (!GROUNDS.includes(ground as Ground)) return null;
    if (height !== undefined && !(Number.isInteger(height) && (height as number) >= 0 && (height as number) <= MAX_HEIGHT)) return null;
    if (ramp !== undefined && ramp !== true) return null;
    if (bridge !== undefined && bridge !== true) return null;
    const cell: IslandCell = { ground: ground as Ground };
    if (height) cell.height = height as number;
    if (ramp) cell.ramp = true;
    if (bridge && ground === "river" && !ramp) cell.bridge = true;
    if (decor !== undefined) {
      if (!DECOR_KINDS.includes(decor as DecorKind)) return null;
      cell.decor = decor as DecorKind;
    }
    parsed.push(cell);
  }
  return { size: size!, cells: parsed };
}

const ISLAND_FILE = "island.json";

export async function loadIsland(): Promise<IslandLayout> {
  try {
    if (!(await exists(ISLAND_FILE, { baseDir: BaseDirectory.AppData }))) return defaultIsland(ISLAND_SIZE);
    const parsed = parseIsland(JSON.parse(await readTextFile(ISLAND_FILE, { baseDir: BaseDirectory.AppData })));
    return parsed ?? defaultIsland(ISLAND_SIZE);
  } catch {
    return defaultIsland(ISLAND_SIZE);
  }
}

export async function saveIsland(island: IslandLayout): Promise<void> {
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
  await writeTextFile(ISLAND_FILE, JSON.stringify(island), { baseDir: BaseDirectory.AppData });
}

export type IslandTool = Ground | DecorKind | "erase" | "raise" | "lower" | "ramp" | "bridge";

/** One stroke of the editor on cell `n`. Returns a new layout (or the same one
 * when nothing changes, so React can skip the re-render and the save). */
export function paintCell(island: IslandLayout, n: number, tool: IslandTool): IslandLayout {
  const cell = island.cells[n];
  if (!cell || n === nestCell(island.size)) return island;
  const { ground, decor, height = 0, ramp, bridge } = cell;
  const [i, j] = [n % island.size, Math.floor(n / island.size)];
  // A step bigger than one block would leave a cliff no ramp can climb.
  const stepOk = (h: number) =>
    EDGES.every(([, di, dj]) => {
      const neighbour = cellAt(island, i + di, j + dj);
      return !neighbour || Math.abs((neighbour.height ?? 0) - h) <= 1;
    });
  let next: IslandCell;
  if (tool === "erase") next = { ground, height, ramp, bridge };
  else if (tool === "raise") {
    const h = Math.min(MAX_HEIGHT, height + 1);
    next = stepOk(h) ? { ...cell, height: h } : cell;
  } else if (tool === "lower") {
    const h = Math.max(0, height - 1);
    next = stepOk(h) ? { ...cell, height: h } : cell;
  }
  // A slope has nowhere to put a tree.
  else if (tool === "ramp") next = canRamp(ground) ? { ground, height, ramp: ramp ? undefined : true } : cell;
  // A footbridge goes across a river, never down a slope.
  else if (tool === "bridge") next = ground === "river" && !ramp ? { ground, height, bridge: bridge ? undefined : true } : cell;
  // Repainting the ground keeps what stands there, unless the new ground can't hold it.
  else if ((GROUNDS as readonly string[]).includes(tool)) {
    const g = tool as Ground;
    next = { ground: g, height, ramp: ramp && canRamp(g) ? true : undefined, bridge: bridge && g === "river" ? true : undefined, decor: canHoldDecor(g) && !ramp ? decor : undefined };
  } else next = canHoldDecor(ground) && !ramp ? { ...cell, decor: tool as DecorKind } : cell;
  if (next.ground === ground && next.decor === decor && (next.height ?? 0) === height && next.ramp === ramp && next.bridge === bridge) return island;
  // Keep the saved file free of default values.
  const clean: IslandCell = { ground: next.ground };
  if (next.decor) clean.decor = next.decor;
  if (next.height) clean.height = next.height;
  if (next.ramp) clean.ramp = true;
  if (next.bridge) clean.bridge = true;
  const cells = island.cells.slice();
  cells[n] = clean;
  return { ...island, cells };
}

export type Edge = "nw" | "ne" | "se" | "sw";
/** A cell's neighbour across each edge, as (di, dj). */
export const EDGES: [Edge, number, number][] = [
  ["nw", -1, 0],
  ["ne", 0, -1],
  ["se", 1, 0],
  ["sw", 0, 1],
];
export const OPPOSITE_EDGE: Record<Edge, Edge> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
/** The step across each edge, as (di, dj). */
export const STEP: Record<Edge, readonly [number, number]> = { nw: [-1, 0], ne: [0, -1], se: [1, 0], sw: [0, 1] };

export type Corner = "n" | "e" | "s" | "w";
/** A cell's corners, top one first, each with the two edges that meet there. */
export const CORNERS: readonly (readonly [Corner, Edge, Edge])[] = [
  ["n", "nw", "ne"],
  ["e", "ne", "se"],
  ["s", "se", "sw"],
  ["w", "nw", "sw"],
];
const CORNER_INDEX = { n: 0, e: 1, s: 2, w: 3 } as const;
const cornerEdges = (corner: Corner) => CORNERS[CORNER_INDEX[corner]]!;

export const cellAt = (island: IslandLayout, i: number, j: number): IslandCell | undefined =>
  i >= 0 && j >= 0 && i < island.size && j < island.size ? island.cells[j * island.size + i] : undefined;
const heightAt = (island: IslandLayout, i: number, j: number) => cellAt(island, i, j)?.height ?? 0;

/** Which way a ramp cell climbs: towards the first neighbour exactly one block
 * higher. `null` (drawn flat) when there's none to climb to. */
export function rampDirection(island: IslandLayout, i: number, j: number): Edge | null {
  const cell = cellAt(island, i, j);
  if (!cell?.ramp || !canRamp(cell.ground)) return null;
  const h = cell.height ?? 0;
  for (const [edge, di, dj] of EDGES) if (heightAt(island, i + di, j + dj) === h + 1) return edge;
  return null;
}

/** A ramp up to two neighbours at once, the edges either side of this corner: an inside corner. */
export function rampInside(island: IslandLayout, i: number, j: number): Corner | null {
  const cell = cellAt(island, i, j);
  if (!cell?.ramp || !turnsCorners(cell.ground)) return null;
  const up = (cell.height ?? 0) + 1;
  for (const [corner, a, b] of CORNERS) if (heightAt(island, i + STEP[a][0], j + STEP[a][1]) === up && heightAt(island, i + STEP[b][0], j + STEP[b][1]) === up) return corner;
  return null;
}

/** A ramp with no neighbour a block up, rising to the cell across this corner: an outside corner. */
export function rampOutside(island: IslandLayout, i: number, j: number): Corner | null {
  const cell = cellAt(island, i, j);
  if (!cell?.ramp || !turnsCorners(cell.ground) || rampDirection(island, i, j)) return null;
  const up = (cell.height ?? 0) + 1;
  for (const [corner, a, b] of CORNERS) if (heightAt(island, i + STEP[a][0] + STEP[b][0], j + STEP[a][1] + STEP[b][1]) === up) return corner;
  return null;
}

/** How far up a slope towards `edge` (u, v) is, 0 to 1, in cell units from the cell's own corner. */
const rise = (edge: Edge, fu: number, fv: number) => (edge === "nw" ? 1 - fu : edge === "ne" ? 1 - fv : edge === "se" ? fu : fv);

/** Ground height, in blocks, at (u, v) in cell units, inside cell (i, j):
 * the cell's height, or on a ramp, a climb to the next block: straight, or
 * round a corner as the pack draws it. */
export function surfaceHeight(island: IslandLayout, i: number, j: number, u: number, v: number): number {
  const h = heightAt(island, i, j);
  const dir = rampDirection(island, i, j);
  const corner = dir ? rampInside(island, i, j) : rampOutside(island, i, j);
  if (!dir && !corner) return h;
  const [fu, fv] = [Math.min(1, Math.max(0, u - i)), Math.min(1, Math.max(0, v - j))];
  if (!corner) return h + rise(dir!, fu, fv);
  const [, a, b] = cornerEdges(corner);
  // Inside, the higher of the two slopes; outside, only the corner itself is up.
  return h + (dir ? Math.max : Math.min)(rise(a, fu, fv), rise(b, fu, fv));
}

/** Ground a blob can ever be on, standing or passing through: not water, not
 * a river. */
export const canPass = (ground: Ground) => ground !== "water" && ground !== "river";

/** Whether a blob may stop at ground point (x, y) in [0, 1]²: not in water,
 * and not inside a tree or a rock. It may still walk across either. */
export function canStopAt(island: IslandLayout, p: { x: number; y: number }): boolean {
  const [i, j] = [Math.floor(p.x * island.size), Math.floor(p.y * island.size)];
  const cell = cellAt(island, Math.min(island.size - 1, i), Math.min(island.size - 1, j));
  return !cell || (canPass(cell.ground) && !cell.decor);
}

/** Which of the layout's nests a blob sleeps in: always the same one while
 * the island stays the same, and the same as its partner's. */
export function homeNest(island: IslandLayout, seed: string, partner?: string | null): number {
  const count = island.nests?.length ?? 0;
  if (count < 2) return 0;
  const key = partner && partner < seed ? partner : seed;
  let h = 0;
  for (let k = 0; k < key.length; k++) h = (Math.imul(h, 31) + key.charCodeAt(k)) | 0;
  return (h >>> 0) % count;
}

/** `p` if a blob can stand there, else the middle of the nearest cell it can
 * stand on — the sim picks points without knowing the terrain. On a layout
 * with its own nests, a sleeping spot in the sim's NEST corner moves into
 * nest `home` (see `homeNest`). */
export function snapToGround(island: IslandLayout, p: GroundPoint, home = 0): GroundPoint {
  const nest = island.nests?.[home % island.nests.length];
  if (nest && p.x >= NEST.min && p.x <= NEST.max && p.y >= NEST.min && p.y <= NEST.max) {
    const k = (2 * nest.r) / (NEST.max - NEST.min);
    p = { x: nest.x - nest.r + (p.x - NEST.min) * k, y: nest.y - nest.r + (p.y - NEST.min) * k };
  }
  if (canStopAt(island, p)) return p;
  const [i, j] = cellOf(island.size, p);
  const n = nearestStops(island)[j * island.size + i]!;
  return n < 0 ? p : { x: ((n % island.size) + 0.5) / island.size, y: (Math.floor(n / island.size) + 0.5) / island.size };
}

// Per layout (layouts are immutable): each cell's nearest cell a blob can stop on.
const nearestCache = new WeakMap<IslandLayout, Int32Array>();
function nearestStops(island: IslandLayout): Int32Array {
  let nearest = nearestCache.get(island);
  if (nearest) return nearest;
  const { size } = island;
  const centre = (n: number) => ({ x: ((n % size) + 0.5) / size, y: (Math.floor(n / size) + 0.5) / size });
  // A breadth-first flood out from every stop at once: each cell gets the
  // first stop to reach it, the nearest in steps (near enough in distance).
  nearest = new Int32Array(size * size).fill(-1);
  const queue: number[] = [];
  island.cells.forEach((_, n) => {
    if (canStopAt(island, centre(n))) nearest![n] = n;
    if (nearest![n] >= 0) queue.push(n);
  });
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head]!;
    const [i, j] = [n % size, Math.floor(n / size)];
    for (const [, di, dj] of EDGES) {
      const [a, b] = [i + di, j + dj];
      if (a < 0 || b < 0 || a >= size || b >= size || nearest[b * size + a]! >= 0) continue;
      nearest[b * size + a] = nearest[n]!;
      queue.push(b * size + a);
    }
  }
  nearestCache.set(island, nearest);
  return nearest;
}

const cellOf = (size: number, p: GroundPoint) =>
  [Math.min(size - 1, Math.max(0, Math.floor(p.x * size))), Math.min(size - 1, Math.max(0, Math.floor(p.y * size)))] as const;

/** Whether a blob may step directly from one orthogonally adjacent cell to
 * another: neither is water (bar a bridge), and any height difference is bridged by a ramp
 * climbing the right way (see `rampDirection`) — never a bare cliff. A ramp
 * round an inside corner is still walked up its first side only: the garden
 * every client lays out stays the same. */
// Called millions of times while an island is laid out and routed: no temporary arrays in here.
export function canStep(island: IslandLayout, i1: number, j1: number, i2: number, j2: number): boolean {
  const a = cellAt(island, i1, j1);
  const b = cellAt(island, i2, j2);
  if (!a || !b || !(canPass(a.ground) || a.bridge) || !(canPass(b.ground) || b.bridge)) return false;
  const diff = (b.height ?? 0) - (a.height ?? 0);
  if (Math.abs(diff) > 1) return false;
  if (diff === 0) return true;
  let edge: Edge | undefined;
  for (const e of EDGES) if (i1 + e[1] === i2 && j1 + e[2] === j2) edge = e[0];
  if (!edge) return false;
  return diff === 1 ? rampDirection(island, i1, j1) === edge : rampDirection(island, i2, j2) === OPPOSITE_EDGE[edge];
}

/** A walk from `from` to `to` as a line of waypoints that only crosses
 * passable ground and only changes height through a ramp: the shortest
 * hop-by-hop route between their cells, as cell centres, snapped to the
 * exact endpoints. Falls back to a straight line when no route exists (e.g.
 * a moated plot with no bridge). */
export function findPath(island: IslandLayout, from: GroundPoint, to: GroundPoint): GroundPoint[] {
  const { size } = island;
  const [si, sj] = cellOf(size, from);
  const [ei, ej] = cellOf(size, to);
  if (si === ei && sj === ej) return [from, to];
  // The scene asks every frame for the same few walks: route each pair of cells once.
  let cache = pathCache.get(island);
  if (!cache) pathCache.set(island, (cache = new Map()));
  const cacheKey = ((sj * size + si) * size + ej) * size + ei;
  let route = cache.get(cacheKey);
  if (route === undefined) {
    if (cache.size > 5000) cache.clear();
    route = routeCells(island, sj * size + si, ej * size + ei);
    cache.set(cacheKey, route);
  }
  if (!route) return [from, to];
  const waypoints = Array.from(route, (n) => ({ x: ((n % size) + 0.5) / size, y: (Math.floor(n / size) + 0.5) / size }));
  waypoints[0] = from;
  waypoints[waypoints.length - 1] = to;
  return waypoints;
}

/** Whether a blob can walk the straight line from `a` to `b`: every cell it
 * crosses is a legal step from the one before (no water, no bare cliff). */
export function canWalkStraight(island: IslandLayout, a: GroundPoint, b: GroundPoint): boolean {
  const { size } = island;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * size * 2));
  let [pi, pj] = cellOf(size, a);
  for (let s = 1; s <= steps; s++) {
    const [ci, cj] = cellOf(size, { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
    if (ci === pi && cj === pj) continue;
    // Crossing a corner takes both ways round it.
    const ok =
      ci === pi || cj === pj
        ? canStep(island, pi, pj, ci, cj)
        : canStep(island, pi, pj, ci, pj) && canStep(island, ci, pj, ci, cj) && canStep(island, pi, pj, pi, cj) && canStep(island, pi, cj, ci, cj);
    if (!ok) return false;
    [pi, pj] = [ci, cj];
  }
  return true;
}

// Routes as cell indices (j * size + i), keyed by both ends.
const pathCache = new WeakMap<IslandLayout, Map<number, Int32Array | null>>();
// One set of buffers for every search: a route is asked for often, on a big
// map, and allocating per search is what kept the webview's memory high.
let search = { prev: new Int32Array(0), seen: new Uint32Array(0), queue: new Int32Array(0), mark: 0 };

/** The cells of the shortest hop-by-hop route from cell `start` to `end`, both included, or null. */
function routeCells(island: IslandLayout, start: number, end: number): Int32Array | null {
  const { size } = island;
  const cells = size * size;
  if (search.prev.length < cells) search = { prev: new Int32Array(cells), seen: new Uint32Array(cells), queue: new Int32Array(cells), mark: 0 };
  const { prev, seen, queue } = search;
  // A new mark per search: no clearing `seen` between them.
  const mark = ++search.mark;
  seen[start] = mark;
  let tail = 0;
  queue[tail++] = start;
  let reached = false;
  for (let head = 0; head < tail; head++) {
    const n = queue[head]!;
    if (n === end) {
      reached = true;
      break;
    }
    const i = n % size;
    const j = (n - i) / size;
    for (const e of EDGES) {
      const ni = i + e[1];
      const nj = j + e[2];
      const m = nj * size + ni;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size || seen[m] === mark || !canStep(island, i, j, ni, nj)) continue;
      seen[m] = mark;
      prev[m] = n;
      queue[tail++] = m;
    }
  }
  if (!reached) return null;
  let length = 1;
  for (let k = end; k !== start; k = prev[k]!) length++;
  const route = new Int32Array(length);
  for (let k = end, at = length - 1; at >= 0; k = prev[k]!, at--) route[at] = k;
  return route;
}
