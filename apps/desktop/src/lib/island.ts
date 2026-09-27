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
/** Grounds the pack draws as a slope. Dirt has no ramp of its own, and water can't run uphill. */
export const canRamp = (ground: Ground) => ground === "grass" || ground === "sand" || ground === "snow" || ground === "road";
/** How many blocks a cell can be stacked above the base level. */
export const MAX_HEIGHT = 2;

// Decor ids from before the full pack was exported, so older island.json files still load.
const LEGACY_DECOR: Record<string, DecorKind> = {
  "tree-poplar": "tree-2",
  "tree-pine": "tree-4",
  "tree-oak": "tree-6",
  "bush-small": "bush-3",
  "bush-large": "bush-4",
  rock: "rock-2",
  rocks: "rock-4",
  "rock-sand": "rock-sand-2",
  "rocks-sand": "rock-sand-8",
  "cactus-tall": "cactus-4",
  "cactus-short": "cactus-2",
};

export interface IslandCell {
  ground: Ground;
  decor?: DecorKind;
  /** Blocks stacked above the base level, 0 (default) to MAX_HEIGHT. */
  height?: number;
  /** A slope up to the neighbour one block higher (see `rampDirection`). */
  ramp?: true;
}

/**
 * A `size` x `size` walkable grid, row-major (`cells[j * size + i]`, i along
 * ground x, j along ground y). Local only: the private island a user edits.
 * The public garden always renders `defaultIsland`.
 */
export interface IslandLayout {
  size: number;
  cells: IslandCell[];
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
    const { ground, decor, height, ramp } = c as { ground?: unknown; decor?: unknown; height?: unknown; ramp?: unknown };
    if (!GROUNDS.includes(ground as Ground)) return null;
    if (height !== undefined && !(Number.isInteger(height) && (height as number) >= 0 && (height as number) <= MAX_HEIGHT)) return null;
    if (ramp !== undefined && ramp !== true) return null;
    const cell: IslandCell = { ground: ground as Ground };
    if (height) cell.height = height as number;
    if (ramp) cell.ramp = true;
    if (decor !== undefined) {
      const kind = DECOR_KINDS.includes(decor as DecorKind)
        ? (decor as DecorKind)
        : typeof decor === "string" && Object.prototype.hasOwnProperty.call(LEGACY_DECOR, decor)
          ? LEGACY_DECOR[decor]
          : undefined;
      if (!kind) return null;
      cell.decor = kind;
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

export type IslandTool = Ground | DecorKind | "erase" | "raise" | "lower" | "ramp";

/** One stroke of the editor on cell `n`. Returns a new layout (or the same one
 * when nothing changes, so React can skip the re-render and the save). */
export function paintCell(island: IslandLayout, n: number, tool: IslandTool): IslandLayout {
  const cell = island.cells[n];
  if (!cell || n === nestCell(island.size)) return island;
  const { ground, decor, height = 0, ramp } = cell;
  const [i, j] = [n % island.size, Math.floor(n / island.size)];
  // A step bigger than one block would leave a cliff no ramp can climb.
  const stepOk = (h: number) =>
    EDGES.every(([, di, dj]) => {
      const neighbour = cellAt(island, i + di, j + dj);
      return !neighbour || Math.abs((neighbour.height ?? 0) - h) <= 1;
    });
  let next: IslandCell;
  if (tool === "erase") next = { ground, height, ramp };
  else if (tool === "raise") {
    const h = Math.min(MAX_HEIGHT, height + 1);
    next = stepOk(h) ? { ...cell, height: h } : cell;
  } else if (tool === "lower") {
    const h = Math.max(0, height - 1);
    next = stepOk(h) ? { ...cell, height: h } : cell;
  }
  // A slope has nowhere to put a tree.
  else if (tool === "ramp") next = canRamp(ground) ? { ground, height, ramp: ramp ? undefined : true } : cell;
  // Repainting the ground keeps what stands there, unless the new ground can't hold it.
  else if ((GROUNDS as readonly string[]).includes(tool)) {
    const g = tool as Ground;
    next = { ground: g, height, ramp: ramp && canRamp(g) ? true : undefined, decor: canHoldDecor(g) && !ramp ? decor : undefined };
  } else next = canHoldDecor(ground) && !ramp ? { ...cell, decor: tool as DecorKind } : cell;
  if (next.ground === ground && next.decor === decor && (next.height ?? 0) === height && next.ramp === ramp) return island;
  // Keep the saved file free of default values.
  const clean: IslandCell = { ground: next.ground };
  if (next.decor) clean.decor = next.decor;
  if (next.height) clean.height = next.height;
  if (next.ramp) clean.ramp = true;
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

export const cellAt = (island: IslandLayout, i: number, j: number): IslandCell | undefined =>
  i >= 0 && j >= 0 && i < island.size && j < island.size ? island.cells[j * island.size + i] : undefined;

/** Which way a ramp cell climbs: towards the first neighbour exactly one block
 * higher. `null` (drawn flat) when there's none to climb to. */
export function rampDirection(island: IslandLayout, i: number, j: number): Edge | null {
  const cell = cellAt(island, i, j);
  if (!cell?.ramp || !canRamp(cell.ground)) return null;
  const h = cell.height ?? 0;
  for (const [edge, di, dj] of EDGES) if ((cellAt(island, i + di, j + dj)?.height ?? 0) === h + 1) return edge;
  return null;
}

/** Ground height, in blocks, at (u, v) in cell units, inside cell (i, j):
 * the cell's height, or on a ramp, a straight climb to the next block. */
export function surfaceHeight(island: IslandLayout, i: number, j: number, u: number, v: number): number {
  const h = cellAt(island, i, j)?.height ?? 0;
  const dir = rampDirection(island, i, j);
  if (!dir) return h;
  const [fu, fv] = [Math.min(1, Math.max(0, u - i)), Math.min(1, Math.max(0, v - j))];
  return h + { nw: 1 - fu, ne: 1 - fv, se: fu, sw: fv }[dir];
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

const cellOf = (size: number, p: GroundPoint) =>
  [Math.min(size - 1, Math.max(0, Math.floor(p.x * size))), Math.min(size - 1, Math.max(0, Math.floor(p.y * size)))] as const;

/** Whether a blob may step directly from one orthogonally adjacent cell to
 * another: neither is water, and any height difference is bridged by a ramp
 * climbing the right way (see `rampDirection`) — never a bare cliff. */
export function canStep(island: IslandLayout, i1: number, j1: number, i2: number, j2: number): boolean {
  const [a, b] = [cellAt(island, i1, j1), cellAt(island, i2, j2)];
  if (!a || !b || !canPass(a.ground) || !canPass(b.ground)) return false;
  const diff = (b.height ?? 0) - (a.height ?? 0);
  if (Math.abs(diff) > 1) return false;
  if (diff === 0) return true;
  const edge = EDGES.find(([, di, dj]) => i1 + di === i2 && j1 + dj === j2)?.[0];
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
  const key = (i: number, j: number) => j * size + i;
  const prev = new Map<number, number>();
  const seen = new Set<number>([key(si, sj)]);
  const queue: [number, number][] = [[si, sj]];
  let reached = false;
  for (let head = 0; head < queue.length; head++) {
    const [i, j] = queue[head]!;
    if (i === ei && j === ej) {
      reached = true;
      break;
    }
    for (const [, di, dj] of EDGES) {
      const [ni, nj] = [i + di, j + dj];
      if (ni < 0 || nj < 0 || ni >= size || nj >= size || seen.has(key(ni, nj)) || !canStep(island, i, j, ni, nj)) continue;
      seen.add(key(ni, nj));
      prev.set(key(ni, nj), key(i, j));
      queue.push([ni, nj]);
    }
  }
  if (!reached) return [from, to];
  const cells: [number, number][] = [[ei, ej]];
  for (let k = key(ei, ej); k !== key(si, sj); ) {
    k = prev.get(k)!;
    cells.push([k % size, Math.floor(k / size)]);
  }
  cells.reverse();
  const waypoints = cells.map(([i, j]) => ({ x: (i + 0.5) / size, y: (j + 0.5) / size }));
  waypoints[0] = from;
  waypoints[waypoints.length - 1] = to;
  return waypoints;
}
