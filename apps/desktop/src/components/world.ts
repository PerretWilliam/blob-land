/*
 * The garden, drawn with WebGL (PixiJS): the ground, what stands on it, the
 * blobs, the nests, the clouds and the map's dots, in one canvas.
 *
 * The scene (scene.tsx) decides where everything is, frame by frame; this
 * draws it. What used to be thousands of DOM elements, each laid out, styled
 * and painted by the webview, is now sprites batched on the GPU: the ground
 * and decor of the chunks in view, and the blobs near the screen, each built
 * from its blobatar's own shapes and moved exactly as blobatar's stylesheet
 * moves it (see lib/blob-motion.ts).
 */
import type { Sex } from "@blob-land/sim";
import type { Expression } from "blobatar/expression";
import { idleAt, idleSeeds, type IdleSeeds } from "blobatar/idle";
import { _posed, fadeHex, lerpPose } from "blobatar/internal";
import { Application, ColorMatrixFilter, Container, Graphics, GraphicsContext, GraphicsPath, ImageSource, Matrix, RenderTexture, Sprite, Texture } from "pixi.js";
import { genderAnchor, SIGNS } from "@/components/blob-gender";
import type { Moment } from "@/components/interaction-fx";
import { Sky } from "@/components/sky";
import DECOR_WIDTHS from "@/assets/iso/widths.json";
import {
  canHoldDecor,
  cellAt,
  CORNERS,
  DECOR_KINDS,
  EDGES,
  OPPOSITE_EDGE,
  rampDirection,
  rampInside,
  rampOutside,
  STEP,
  type DecorKind,
  type Edge,
  type Ground,
  type IslandLayout,
} from "@/lib/island";
import {
  Affine,
  breatheTransform,
  eyeTransform,
  glanceTransform,
  LIFT,
  MORPH_IN,
  MORPH_OUT,
  morphProgress,
  moveAt,
  rootTransform,
  type EyeFrame,
  type Morph,
} from "@/lib/blob-motion";

/*
 * Tile geometry, in the sprite pack's own pixels: tiles are true isometric
 * (diamond ratio ~sqrt(3), not 2:1). One grid step is half a diamond, and
 * outlines overlap so neighbours share an edge. Every block piece (tiles,
 * roads, rivers, ramps) is exported on the same 304 x 296 canvas, bottom
 * aligned, with the top vertex's outline centre 152px in and 15.3px down.
 */
export const HALF_W = 139;
export const HALF_H = 81;
const TILE_IMG_W = 304;
const TOP_X = 152;
const TOP_Y = 15.3;
const SIDE_H = 109;
// One block of height: a stacked block sits this much higher on screen.
export const LEVEL = 109;
// Water's surface sits this much below the banks (tile-water is that much
// shorter than a grass block): a blob stepping in wades.
export const WATER_DROP = 28;
const PAD = 8;
/*
 * Texture pixels per pack pixel. The pack is exported at 2x; drawn at 1x on
 * the GPU, a close-up on a retina screen is a touch soft but a block piece
 * takes ~360 KB of video memory instead of ~1.4 MB, and only the pieces an
 * island uses are loaded.
 * ponytail: one resolution for every zoom; load the 2x set for the pieces in
 * view when following a blob if the softness shows.
 */
const TEX_PER_PACK = 1;
// The whole island baked into one picture for the zoomed-out map: its longest side, in px.
const BAKE_PX = 6144;
// On-screen size of a map dot, in CSS px: everyone's, and the player's own.
const DOT_PX = 7;
const HOME_DOT_PX = 12;
// Grounds are grouped in square chunks of this many cells a side, mounted as they come into view.
export const CHUNK = 8;
/*
 * On a big map, past this many cells in view, the scene shows the map
 * instead: the island baked in one picture, with blobs as dots, which is all
 * you can make out from that far anyway.
 */
export const MAP_CELLS = 8000;
// Names and meeting effects are HTML, costly by the hundred and unreadable from
// far off: past this many cells in view, blobs go on without them.
export const NAME_CELLS = 2500;
// Sprites reach this far past the grid points they hang off (trees, stacks), in pack px.
const CHUNK_PAD = 420;

/*
 * The island is `tiles` rows by `tiles + 1` columns: the extra column along
 * the right-hand front edge is a stream, outside the walkable [0, 1]² square
 * positionAt covers, so nobody ever walks on water. `lift` is the tallest
 * stack in blocks, which needs room above the back row.
 */
export function islandGeometry(tiles: number, lift: number) {
  const cols = tiles + 1;
  const rows = tiles;
  const top = PAD + lift * LEVEL;
  const w = (cols + rows) * HALF_W + 2 * PAD;
  const h = (cols + rows) * HALF_H + SIDE_H + PAD + top;
  // Grid point (u, v), in tile units, at `height` blocks -> pack px from the island's top-left corner.
  const at = (u: number, v: number, height = 0) => ({ x: PAD + rows * HALF_W + (u - v) * HALF_W, y: top + (u + v) * HALF_H - height * LEVEL });
  return { cols, rows, w, h, at };
}
export type IslandGeometry = ReturnType<typeof islandGeometry>;

/*
 * Depth order. Everything on cell diagonal d = i + j sits in its own band
 * [10 + 1000d, 10 + 1000(d+1)): the blocks raised above the base level at the
 * bottom of the band, then what stands on the cell, back to front. So a hill
 * hides blobs behind it and never the ones in front or on top. The base-level
 * tiles stay below every band, drawn back to front.
 */
const cellZ = (d: number) => 10 + d * 1000;
export function depthZ(tiles: number, x: number, y: number) {
  const [u, v] = [x * tiles, y * tiles];
  const [i, j] = [Math.min(tiles - 1, Math.floor(u)), Math.min(tiles - 1, Math.floor(v))];
  return cellZ(i + j) + 1 + Math.round((u - i + (v - j)) * 490);
}

// Sprites are exported at 2x from the pack's SVG; `w` is the native width, in
// the same pack pixels as the tile geometry.
const DECOR_FILES = import.meta.glob<string>("../assets/iso/{tree,bush,rock,cactus}-*.png", { eager: true, import: "default" });
export const DECOR_SPRITES = Object.fromEntries(
  DECOR_KINDS.map((kind) => [kind, { src: DECOR_FILES[`../assets/iso/${kind}.png`]!, w: (DECOR_WIDTHS as Record<string, number>)[kind]! }]),
) as Record<DecorKind, { src: string; w: number }>;

/*
 * Block pieces, by file name (banks: -sand, -snow, and -ice for a frozen river):
 * - tile-<ground>
 * - road|river|bridge[<bank>]-<edges>[-open-<corners>], the corners where water
 *   runs on round the bank instead of a nub; road[<bank>]-<edges>-square
 * - culvert[<bank>]-<edge>: a road over a river coming in from that edge
 * - ramp[-road|-river][<bank>]-<edge>, or up two edges (an inside corner), or
 *   up to one corner (an outside one)
 */
const PIECES = import.meta.glob<string>("../assets/iso/{tile,road,river,bridge,culvert,ramp}-*.png", { eager: true, import: "default" });
const piece = (name: string) => PIECES[`../assets/iso/${name}.png`]!;
const hasPiece = (name: string) => `../assets/iso/${name}.png` in PIECES;

/** Thumbnails for the editor's tools. */
export const GROUND_THUMBS = Object.fromEntries(
  (["grass", "sand", "dirt", "snow", "water", "ice"] as const).map((g) => [g, piece(`tile-${g}`)]),
) as Record<Ground, string>;
GROUND_THUMBS.road = piece("road-nw-se");
GROUND_THUMBS.river = piece("river-nw-se");
export const RAMP_THUMB = piece("ramp-nw");
export const BRIDGE_THUMB = piece("bridge-nw-se");

/*
 * Roads, rivers and ramps come with grass, sand or snow banks: take whichever
 * the cells around have most of, so a road through the desert is a sand road.
 */
function bankAt(layout: IslandLayout, i: number, j: number): "" | "-sand" | "-snow" {
  const n = { grass: 0, sand: 0, snow: 0 };
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const g = cellAt(layout, i + di, j + dj)?.ground;
      if (g === "sand") n.sand++;
      else if (g === "snow" || g === "ice") n.snow++;
      else if (g === "grass" || g === "dirt") n.grass++;
    }
  if (n.sand > n.grass && n.sand >= n.snow) return "-sand";
  return n.snow > n.grass ? "-snow" : "";
}

/** A river's banks: as `bankAt`, and in the snow, frozen over when it touches ice. */
function riverBankAt(layout: IslandLayout, i: number, j: number): string {
  const bank = bankAt(layout, i, j);
  if (bank !== "-snow") return bank;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (cellAt(layout, i + di, j + dj)?.ground === "ice") return "-ice";
  return bank;
}

/** Water a river runs on into: a river, a lake, ice, or the stream past the
 * grid; for a lake, the open sea all round too. */
function wet(layout: IslandLayout, i: number, j: number, sea = false): boolean {
  if (i === layout.size && j >= 0 && j < layout.size) return true;
  if (sea && !cellAt(layout, i, j)) return true;
  const g = cellAt(layout, i, j)?.ground;
  return g === "river" || g === "water" || g === "ice";
}

/** A flat road a river can run under, through a culvert. */
function culvertAt(layout: IslandLayout, i: number, j: number, height: number): boolean {
  const c = cellAt(layout, i, j);
  return c?.ground === "road" && (c.height ?? 0) === height && !c.ramp;
}

/*
 * Road and river pieces are named by the tile edges they open onto (EDGES:
 * nw = (i-1, j), ne = (i, j-1), se = (i+1, j), sw = (i, j+1)), so corners,
 * junctions and dead ends lay themselves out from the neighbours. Rivers also
 * run into water, including the stream along the front edge, and under a road
 * they head straight into.
 */
function linkedEdges(layout: IslandLayout, i: number, j: number, ground: "road" | "river"): Edge[] {
  const height = cellAt(layout, i, j)?.height ?? 0;
  const edges = EDGES.filter(([edge, di, dj]) => {
    const [a, b] = [i + di, j + dj];
    if (ground === "river" && a === layout.size && b >= 0 && b < layout.size) return true;
    const neighbour = cellAt(layout, a, b);
    // Roads run on over a bridge; rivers into the sea.
    if (!(neighbour?.ground === ground || (ground === "river" && (neighbour?.ground === "water" || neighbour?.ground === "ice")) || (ground === "road" && neighbour?.bridge))) return false;
    const neighbourHeight = neighbour?.height ?? 0;
    const rampEdge = rampDirection(layout, a, b);
    // Level ground: a ramp only opens onto its flat (low) front, never its side walls.
    if (neighbourHeight === height) return !rampEdge || rampEdge === edge;
    // One block up: only where the ramp actually climbs up to us.
    if (neighbourHeight === height - 1) return rampEdge === OPPOSITE_EDGE[edge];
    return false;
  }).map(([edge]) => edge);
  if (ground === "river") {
    const under = EDGES.filter(([edge, di, dj]) => edges.includes(OPPOSITE_EDGE[edge]) && culvertAt(layout, i + di, j + dj, height)).map(([edge]) => edge);
    edges.push(...under);
    edges.sort((a, b) => EDGE_ORDER[a] - EDGE_ORDER[b]);
  }
  return edges;
}
const EDGE_ORDER: Record<Edge, number> = { nw: 0, ne: 1, se: 2, sw: 3 };

/**
 * A river or bridge piece: by its open edges, and where two of them meet over
 * more water, without the nub of bank in that corner, so a wide river or a
 * pool reads as one sheet of water. The pack doesn't draw every mix: the
 * piece that keeps the fewest nubs it shouldn't.
 */
function riverPiece(layout: IslandLayout, i: number, j: number, kind: "river" | "bridge" | "lake"): string {
  const lake = kind === "lake";
  const bank = lake ? bankAt(layout, i, j) : riverBankAt(layout, i, j);
  // A lake or the sea opens onto all the water round it, and keeps a bank where it meets land.
  const edges = lake ? EDGES.filter(([, di, dj]) => wet(layout, i + di, j + dj, true)).map(([edge]) => edge) : linkedEdges(layout, i, j, "river");
  if (lake && !edges.length) return piece("tile-water");
  if (!edges.length) edges.push("nw", "se");
  const open = CORNERS.filter(([, a, b]) => edges.includes(a) && edges.includes(b) && wet(layout, i + STEP[a][0] + STEP[b][0], j + STEP[a][1] + STEP[b][1], lake)).map(([c]) => c);
  if (kind !== "bridge" && open.length === 4) return piece(bank === "-ice" ? "tile-ice" : "tile-water");
  const base = `${kind === "bridge" ? "bridge" : "river"}${bank}-${edges.join("-")}`;
  let best = hasPiece(base) ? base : null;
  let most = 0;
  for (let mask = 1; mask < 1 << open.length; mask++) {
    const corners = open.filter((_, k) => mask & (1 << k));
    const name = `${base}-open-${corners.join("-")}`;
    if (corners.length > most && hasPiece(name)) [best, most] = [name, corners.length];
  }
  // Bridges only come straight across, on a narrow or a wide river.
  return piece(best ?? `bridge${bank}-${edges.includes("nw") || edges.includes("se") ? "nw-se" : "ne-sw"}`);
}

/** A road piece: over a culvert where a river runs under it (seen from the front if it can), else by its links. */
function roadPiece(layout: IslandLayout, i: number, j: number, bank: string): string {
  const height = cellAt(layout, i, j)?.height ?? 0;
  for (const edge of ["se", "sw", "nw", "ne"] as const) {
    const [a, b] = [i + STEP[edge][0], j + STEP[edge][1]];
    if (cellAt(layout, a, b)?.ground === "river" && (cellAt(layout, a, b)?.height ?? 0) === height && linkedEdges(layout, a, b, "river").includes(OPPOSITE_EDGE[edge]))
      return piece(`culvert${riverBankAt(layout, a, b) === "-ice" ? "-ice" : bank}-${edge}`);
  }
  const edges = linkedEdges(layout, i, j, "road");
  const name = `road${bank}-${(edges.length ? edges : ["nw", "se"]).join("-")}`;
  // Bends come rounded or square: each cell picks one by where it is, so a road keeps its look.
  return (Math.imul(i, 0x9e3779b1) ^ Math.imul(j, 0x85ebca6b)) & 0x10000 && hasPiece(`${name}-square`) ? piece(`${name}-square`) : piece(name);
}

/** The slope on a ramp cell, if it has one: up an edge, round an inside or an outside corner. */
function slopeAt(layout: IslandLayout, i: number, j: number, ground: Ground, bank: string): string | null {
  const material = ground === "road" ? `-road${bank}` : ground === "river" ? `-river${riverBankAt(layout, i, j)}` : ground === "grass" ? "" : `-${ground}`;
  const inside = rampInside(layout, i, j);
  if (inside) {
    const [, a, b] = CORNERS.find(([c]) => c === inside)!;
    return piece(`ramp${material}-${a}-${b}`);
  }
  const outside = rampOutside(layout, i, j);
  if (outside) return piece(`ramp${material}-${outside}`);
  const dir = rampDirection(layout, i, j);
  return dir ? piece(`ramp${material}-${dir}`) : null;
}

/** The pieces a cell stacks, bottom first: plain blocks up to its height, then
 * its own ground (a road, a river…) or, on a ramp, the slope one block up. */
function cellStack(layout: IslandLayout, i: number, j: number): string[] {
  const cell = cellAt(layout, i, j);
  // The column past the grid is the fixed stream.
  if (!cell) return [piece("tile-water")];
  const { ground, height = 0 } = cell;
  const bank = bankAt(layout, i, j);
  const block = canHoldDecor(ground) ? piece(`tile-${ground}`) : piece(`tile${bank ? bank : "-grass"}`);
  const stack = Array.from({ length: height }, () => block);
  const slope = slopeAt(layout, i, j, ground, bank);
  if (slope) return [...stack, block, slope];
  const top =
    ground === "river" ? riverPiece(layout, i, j, cell.bridge ? "bridge" : "river") : ground === "water" ? riverPiece(layout, i, j, "lake") : ground === "road" ? roadPiece(layout, i, j, bank) : piece(`tile-${ground}`);
  return [...stack, top];
}

/** One ground or decor sprite, where the terrain puts it. */
interface TerrainItem {
  i: number;
  j: number;
  src: string;
  /** Pack px: a block's top-left corner, or where a decor sprite stands. */
  x: number;
  y: number;
  /** Native width, in pack px. */
  w: number;
  z: number;
  decor: boolean;
  /** Its place in drawing order, for ties in `z`. */
  seq: number;
}

export interface Chunk {
  items: TerrainItem[];
  /** Pack px the chunk's sprites can reach. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The ground and everything standing on it, in chunks. */
function terrainOf(layout: IslandLayout, island: IslandGeometry): Map<string, Chunk> {
  const tiles = layout.size;
  // Back to front, so each tile's sides are covered by the tiles in front of it.
  const cells = Array.from({ length: island.cols * island.rows }, (_, n) => ({ i: n % island.cols, j: Math.floor(n / island.cols) })).sort(
    (a, b) => a.i + a.j - (b.i + b.j),
  );
  // Open sea (water all round) isn't drawn: the island floats in the sky
  // with just a ring of shallows, however big the map around it. The sea is
  // the water that reaches the map's edge: a lake inland is drawn whole.
  const sea = new Uint8Array(tiles * tiles);
  const flood: number[] = [];
  layout.cells.forEach((c, n) => {
    const [i, j] = [n % tiles, Math.floor(n / tiles)];
    if (c.ground === "water" && (i === 0 || j === 0 || i === tiles - 1 || j === tiles - 1)) flood.push(n), (sea[n] = 1);
  });
  for (let head = 0; head < flood.length; head++) {
    const n = flood[head]!;
    for (const [, di, dj] of EDGES) {
      const [a, b] = [(n % tiles) + di, Math.floor(n / tiles) + dj];
      if (a < 0 || b < 0 || a >= tiles || b >= tiles || sea[b * tiles + a] || layout.cells[b * tiles + a]!.ground !== "water") continue;
      sea[b * tiles + a] = 1;
      flood.push(b * tiles + a);
    }
  }
  const wet = (i: number, j: number) => !cellAt(layout, i, j) || sea[j * tiles + i] === 1;
  const openSea = (i: number, j: number) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (!wet(i + di, j + dj)) return false;
    return true;
  };
  const items: TerrainItem[] = [];
  const add = (item: Omit<TerrainItem, "seq">) => items.push({ ...item, seq: items.length });
  for (const { i, j } of cells) {
    if (openSea(i, j)) continue;
    cellStack(layout, i, j).forEach((src, level) => {
      const at = island.at(i, j, level);
      // Shift so the image's top vertex (not its corner) lands on the grid point.
      const [x, y] = [at.x - TOP_X, at.y - TOP_Y];
      add({ i, j, src, x, y, w: TILE_IMG_W, z: level === 0 ? 0 : cellZ(i + j), decor: false });
    });
  }
  layout.cells.forEach((cell, n) => {
    if (!cell.decor || !canHoldDecor(cell.ground) || cell.ramp) return;
    const [i, j] = [n % tiles, Math.floor(n / tiles)];
    const { src, w } = DECOR_SPRITES[cell.decor];
    const at = island.at(i + 0.5, j + 0.5, cell.height ?? 0);
    add({ i, j, src, x: at.x, y: at.y, w, z: depthZ(tiles, (i + 0.5) / tiles, (j + 0.5) / tiles), decor: true });
  });
  const chunks = new Map<string, Chunk>();
  for (const item of items) {
    const key = `${Math.floor(item.i / CHUNK)},${Math.floor(item.j / CHUNK)}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = { items: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
    chunk.items.push(item);
    chunk.x0 = Math.min(chunk.x0, item.x - CHUNK_PAD);
    chunk.x1 = Math.max(chunk.x1, item.x + CHUNK_PAD);
    chunk.y0 = Math.min(chunk.y0, item.y - CHUNK_PAD);
    chunk.y1 = Math.max(chunk.y1, item.y + CHUNK_PAD);
  }
  return chunks;
}

// Textures outlive a world: the garden and the island share them, and
// switching between the two shouldn't load them again.
const textures = new Map<string, Promise<Texture>>();
// The same, once loaded: what's here can be drawn in this very frame.
const loadedTextures = new Map<string, Texture>();
/** A sprite file, for drawing `w` pack px wide (at its full size if not given). */
function textureOf(src: string, w?: number): Promise<Texture> {
  let texture = textures.get(src);
  if (!texture) {
    texture = (async () => {
      // Decoded off the page's rendering: `img.decode()` waits on it, and stalls while the page is hidden.
      const img = await createImageBitmap(await (await fetch(src)).blob());
      const width = Math.max(1, Math.round(w ? w * TEX_PER_PACK : img.width));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.max(1, Math.round((width * img.height) / img.width));
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.close();
      const bitmap = await createImageBitmap(canvas);
      return new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: true }) });
    })()
      .catch((error: unknown) => {
        // One broken sprite shouldn't keep the whole island from showing.
        console.error(`Couldn't load the sprite ${src}`, error);
        return Texture.EMPTY;
      })
      .then((loaded) => {
        loadedTextures.set(src, loaded);
        return loaded;
      });
    textures.set(src, texture);
  }
  return texture;
}

/** A sprite for a terrain item, sized and anchored where the terrain puts it. */
function terrainSprite(item: TerrainItem, texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  // Decor is anchored at the sprite's base, a little above its bottom edge.
  if (item.decor) sprite.anchor.set(0.5, 0.92);
  sprite.position.set(item.x, item.y);
  sprite.setSize(item.w, (item.w * texture.height) / texture.width);
  return sprite;
}

// Fixed decor — ambience only, no behaviour. Each of the pack's eight clouds
// (`kind`), white, or grey over a snowy island. `top` and `size` are % of the
// scene; `duration` and `offset` time the drift across it.
const CLOUDS = [
  { kind: 5, top: 6, size: 16, duration: 240, offset: 0.1 },
  { kind: 3, top: 20, size: 10, duration: 190, offset: 0.55 },
  { kind: 1, top: 2, size: 7, duration: 280, offset: 0.8 },
  { kind: 7, top: 13, size: 14, duration: 330, offset: 0.35 },
  { kind: 2, top: 25, size: 6, duration: 230, offset: 0.95 },
  { kind: 4, top: 3, size: 9, duration: 260, offset: 0.62 },
  { kind: 6, top: 17, size: 12, duration: 300, offset: 0.22 },
  { kind: 8, top: 9, size: 13, duration: 360, offset: 0.45 },
];
const CLOUD_FILES = import.meta.glob<string>("../assets/iso/cloud-*.png", { eager: true, import: "default" });
const cloudSrc = (kind: number, grey: boolean) => CLOUD_FILES[`../assets/iso/cloud${grey ? "-grey" : ""}-${kind}.png`]!;
/** Mostly snow and ice: a winter sky. */
const snowy = (layout: IslandLayout) => layout.cells.filter((c) => c.ground === "snow" || c.ground === "ice").length * 2 > layout.cells.length;
// Clouds zoom this fraction as much as the ground: farther away, so they move less.
const CLOUD_PARALLAX = 0.5;

/*
 * Night dims the world: `brightness(b) saturate(s)`, the CSS filters, as one
 * colour matrix over the ground, decor, blobs and clouds together.
 */
function nightMatrix(light: number): number[] {
  const [b, s] = [0.45 + 0.55 * light, 0.55 + 0.45 * light];
  const row = (r: number, g: number, bl: number) => [r * b, g * b, bl * b, 0, 0];
  return [
    ...row(0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s),
    ...row(0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s),
    ...row(0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s),
    0, 0, 0, 1, 0,
  ];
}

/**
 * A nest, `w` pack px wide, centred on (cx, cy), in the pack's style: twigs
 * poking out, a woven rim, and in its hollow a bed of straw with two leaves
 * caught on the edge. Drawn in a 120 x 60 box, scaled.
 */
function drawNest(g: Graphics, cx: number, cy: number, w: number) {
  const s = w / 120;
  const p = (x: number, y: number) => [cx + (x - 60) * s, cy + (y - 30) * s] as const;
  const ink = (width: number) => ({ color: 0x000000, width: width * s, join: "round" as const, cap: "round" as const });
  g.ellipse(...p(60, 38), 62 * s, 27 * s).fill({ color: 0x000000, alpha: 0.12 });
  for (const [x1, y1, x2, y2] of [
    [10, 22, -4, 13],
    [102, 16, 117, 7],
    [18, 46, 4, 55],
    [98, 45, 113, 53],
    [62, 7, 66, -5],
  ] as const) {
    g.moveTo(...p(x1, y1)).lineTo(...p(x2, y2)).stroke(ink(7.5));
    g.moveTo(...p(x1, y1)).lineTo(...p(x2, y2)).stroke({ color: 0xa8683a, width: 3.5 * s, cap: "round" });
  }
  // The rim: its outer wall, then its top, woven.
  g.ellipse(...p(60, 36), 57 * s, 25 * s).fill(0x8f5530).stroke(ink(4.5));
  g.ellipse(...p(60, 30), 57 * s, 24 * s).fill(0xd29a5c).stroke(ink(4.5));
  for (let k = 0; k < 16; k++) {
    const at = (t: number, rx: number, ry: number) => p(60 + rx * Math.cos(t), 30 + ry * Math.sin(t));
    const t = (k / 16) * 2 * Math.PI;
    g.moveTo(...at(t - 0.16, 54, 22.5))
      .quadraticCurveTo(...at(t, 47, 19), ...at(t + 0.16, 54, 22.5))
      .stroke({ color: 0x8f5530, width: 2.5 * s, cap: "round" });
  }
  // The hollow, and the straw blobs sleep on.
  g.ellipse(...p(60, 31), 40 * s, 15 * s).fill(0x6b3f22).stroke(ink(4));
  g.ellipse(...p(60, 34), 33 * s, 10.5 * s).fill(0xf3d27e).stroke(ink(3.5));
  for (const [x1, y1, x2, y2] of [
    [38, 33, 49, 35],
    [54, 38, 65, 37],
    [70, 31, 81, 33],
    [46, 30, 53, 29],
    [74, 37, 82, 36],
  ] as const)
    g.moveTo(...p(x1, y1)).lineTo(...p(x2, y2)).stroke({ color: 0xd39b3c, width: 2.2 * s, cap: "round" });
  for (const [bx, by, ax, ay, tx, ty, cx2, cy2] of [
    [22, 42, 12, 37, 5, 49, 16, 53],
    [93, 15, 99, 4, 111, 7, 106, 18],
  ] as const) {
    g.moveTo(...p(bx, by))
      .quadraticCurveTo(...p(ax, ay), ...p(tx, ty))
      .quadraticCurveTo(...p(cx2, cy2), ...p(bx, by))
      .fill(0x91db69)
      .stroke(ink(3.5));
    g.moveTo(...p(bx, by))
      .lineTo(...p(bx + (tx - bx) * 0.75, by + (ty - by) * 0.75))
      .stroke(ink(2));
  }
}

/** A blob's figure, from its blobatar: shapes drawn once per seed, in white, coloured by tint. */
interface Figure {
  head: GraphicsContext;
  eyes: GraphicsContext[];
  frames: EyeFrame[];
  seeds: IdleSeeds;
  /** Its silhouette, one path per shape, for picking it with the pointer. */
  hit: Path2D[];
}
const figures = new Map<string, Figure>();
function figureOf(seed: string): Figure {
  let figure = figures.get(seed);
  if (figure) return figure;
  const posed = _posed(seed);
  const head = new GraphicsContext();
  const hit: Path2D[] = [];
  for (const mark of posed.marks) {
    if (mark.kind === "circle") {
      head.circle(mark.cx, mark.cy, mark.r).fill(0xffffff);
      const p = new Path2D();
      p.arc(mark.cx, mark.cy, mark.r, 0, 2 * Math.PI);
      hit.push(p);
    } else {
      head.path(new GraphicsPath(mark.d)).fill(0xffffff);
      hit.push(new Path2D(mark.d));
    }
  }
  const eyes = posed.eyes.map((eye) => {
    hit.push(new Path2D(eye.d));
    return new GraphicsContext().path(new GraphicsPath(eye.d)).fill(0xffffff);
  });
  figure = { head, eyes, frames: posed.eyeFrames, seeds: idleSeeds(seed), hit };
  figures.set(seed, figure);
  return figure;
}

const signs = new Map<string, GraphicsContext>();
function signOf(sex: "female" | "male"): GraphicsContext {
  let ctx = signs.get(sex);
  if (ctx) return ctx;
  ctx = new GraphicsContext();
  for (const shape of SIGNS[sex].shapes) {
    if ("ellipse" in shape) ctx.ellipse(...shape.ellipse);
    else ctx.path(new GraphicsPath(shape.d));
    if (shape.fill) ctx.fill(shape.fill);
    ctx.stroke({ color: shape.stroke, width: shape.width, join: "round", cap: "cap" in shape && shape.cap ? shape.cap : "butt" });
  }
  signs.set(sex, ctx);
  return ctx;
}

/** A soft round shadow, stretched to each blob's feet. */
let shadowTexture: Texture | null = null;
function shadowOf(): Texture {
  if (shadowTexture) return shadowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgb(0 0 0 / 0.3)");
  g.addColorStop(0.7, "rgb(0 0 0 / 0.18)");
  g.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (shadowTexture = Texture.from(canvas));
}

const dotTextures = new Map<boolean, Texture>();
/** A map dot: white, or gold for the player's own. Drawn 4x for sharpness. */
function dotOf(home: boolean): Texture {
  let texture = dotTextures.get(home);
  if (texture) return texture;
  const px = (home ? HOME_DOT_PX : DOT_PX) * 4;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, px / 2 - 2, 0, 2 * Math.PI);
  ctx.fillStyle = home ? "#fcd34d" : "#fff";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#000";
  ctx.stroke();
  texture = Texture.from(canvas);
  dotTextures.set(home, texture);
  return texture;
}

const scratch = new Matrix();
const aff = new Affine();
function put(container: Container, m: Affine) {
  scratch.set(m.a, m.b, m.c, m.d, m.e, m.f);
  container.setFromMatrix(scratch);
}
const colour = (hex: string) => parseInt(hex.slice(1), 16);

/** How a blob is walking this frame (see the scene's gait). */
export interface Stride {
  /** 0 on the ground, 1 at the top of a hop. */
  lift: number;
  /** Degrees, lean and waddle together. */
  rotate: number;
  /** Flattening on landing. */
  squash: number;
}

/**
 * One blob, as the blobatar's element tree: the figure scaled into its box,
 * then `.mo-root` (tremor, hover lift), `.mo-breathe`, `.mo-bob`, and in
 * there its shapes, its eye pair and each eye, and the sign it wears.
 */
export class BlobView {
  readonly root = new Container();
  private readonly shadow = new Sprite(shadowOf());
  private readonly body = new Container();
  private readonly figure = new Container();
  private readonly moRoot = new Container();
  private readonly breathe = new Container();
  /** `.mo-bob`, where the shapes are: picking reads the pointer in its frame. */
  readonly bob = new Container();
  private readonly outline = new Container();
  private readonly head: Graphics;
  private readonly eyePair = new Container();
  private readonly eyes: Container[];
  private readonly glances: Container[];
  private readonly eyeShapes: Graphics[];
  private sign: Container | null = null;
  private readonly fig: Figure;
  /** Its size, in pack px. */
  size = 0;
  private sex: Sex | null = null;
  private expression: Expression | null = null;
  private morph: Morph | null = null;
  private moment: Moment | null = null;
  /** When it stopped walking (or its meeting changed while it stood): its one-shot moves start there. */
  private stillSince: number | null = null;
  private stride: Stride = { lift: 0, rotate: 0, squash: 0 };
  private lift = { from: 0, to: 0, start: 0 };
  private tints = { head: "", eye: "" };

  constructor(readonly seed: string) {
    this.fig = figureOf(seed);
    this.shadow.anchor.set(0.5);
    this.head = new Graphics(this.fig.head);
    // A black silhouette under the shapes, nudged 2px each way: the outline
    // on hover, on keyboard focus and while followed.
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const copy = new Graphics(this.fig.head);
      copy.tint = 0x000000;
      copy.position.set(x!, y!);
      this.outline.addChild(copy);
    }
    this.outline.visible = false;
    this.eyeShapes = this.fig.eyes.map((ctx) => new Graphics(ctx));
    this.glances = this.eyeShapes.map((g) => new Container({ children: [g] }));
    this.eyes = this.glances.map((g) => new Container({ children: [g] }));
    this.eyePair.addChild(...this.eyes);
    this.bob.addChild(this.outline, this.head, this.eyePair);
    this.breathe.addChild(this.bob);
    this.moRoot.addChild(this.breathe);
    this.figure.addChild(this.moRoot);
    this.body.addChild(this.figure);
    this.root.addChild(this.shadow, this.body);
  }

  /** What it looks like: `size` in pack px, its sex's sign, its expression (morphed to), its meeting. */
  update(size: number, sex: Sex, expression: Expression, moment: Moment | null, reduced: boolean, now: number) {
    if (size !== this.size) {
      this.size = size;
      // The blobatar's 0–100 box, its bottom 20% below the feet.
      this.figure.scale.set(size / 100);
      this.figure.position.set(-size / 2, -0.8 * size);
    }
    if (sex !== this.sex) {
      this.sex = sex;
      this.sign?.destroy({ children: true });
      this.sign = null;
      const anchor = genderAnchor(this.seed, sex);
      if (anchor && sex !== "none") {
        this.sign = new Container({ children: [new Graphics(signOf(sex))] });
        this.sign.position.set(anchor.x, anchor.y);
        this.sign.angle = anchor.tilt + SIGNS[sex].tilt;
        this.bob.addChild(this.sign);
      }
    }
    if (expression !== this.expression) {
      const posed = _posed(this.seed, { expression });
      const to = lerpPose(undefined, posed.pose, 1);
      const toFill = posed.hot ?? posed.fill;
      const clock = posed.expr ? MORPH_IN : MORPH_OUT;
      const current = this.morph ? this.poseAt(now) : null;
      this.morph = {
        from: current?.pose ?? to,
        fromFill: current?.fill ?? toFill,
        to,
        toFill,
        start: now,
        ms: current && !reduced ? clock.ms : 0,
        ease: clock.ease,
      };
      this.expression = expression;
    }
    if (moment?.key !== this.moment?.key && this.stillSince !== null) this.stillSince = now;
    this.moment = moment;
  }

  private poseAt(now: number) {
    const m = this.morph!;
    const k = morphProgress(m, now);
    return {
      pose: lerpPose(m.from, m.to, k),
      fill: { head: fadeHex(m.fromFill.head, m.toFill.head, k), eye: fadeHex(m.fromFill.eye, m.toFill.eye, k) },
    };
  }

  /** Where its feet are, in pack px, and its depth. */
  place(x: number, y: number, z: number) {
    this.root.position.set(x, y);
    if (this.root.zIndex !== z) this.root.zIndex = z;
  }

  walk(stride: Stride) {
    this.stride = stride;
  }

  /** Walking or standing: a meeting's moves only play once it has arrived. */
  still(still: boolean, now: number) {
    if (!still) this.stillSince = null;
    else this.stillSince ??= now;
  }

  /** Lifted under the pointer, like blobatar's hover. */
  hover(on: boolean, now: number) {
    const to = on ? 1 : 0;
    if (to === this.lift.to) return;
    this.lift = { from: this.liftAt(now), to, start: now };
  }

  private liftAt(now: number) {
    const { from, to, start } = this.lift;
    const k = Math.min(1, (now - start) / (to ? LIFT.inMs : LIFT.outMs));
    return from + (to - from) * LIFT.ease(k);
  }

  /**
   * One frame at `now` (ms, performance clock): the idle loops, the morph,
   * the walk and the meeting's move. `outline` is the outline's width in
   * screen px, 0 for none; `pxPerUnit` how many screen px a pack px is.
   */
  frame(now: number, reduced: boolean, outline: number, pxPerUnit: number) {
    const { pose, fill } = this.poseAt(now);
    // Reduced motion: every loop stops where it starts, as the stylesheet does.
    const f = reduced ? idleAt(this.fig.seeds, 0, 0, 0) : idleAt(this.fig.seeds, now, 1, pose.shake);
    put(this.moRoot, rootTransform(aff, f, reduced ? this.lift.to : this.liftAt(now)));
    put(this.breathe, breatheTransform(aff, f));
    this.bob.position.set(0, pose.bdy + f.bob);
    this.eyePair.position.set(f.saccade[0], f.saccade[1]);
    this.fig.frames.forEach((e, i) => {
      put(this.eyes[i]!, eyeTransform(aff, e, i, pose, f.rockp));
      put(this.glances[i]!, glanceTransform(aff, e, i, f));
    });
    if (fill.head !== this.tints.head) this.head.tint = colour((this.tints.head = fill.head));
    if (fill.eye !== this.tints.eye) for (const g of this.eyeShapes) g.tint = colour((this.tints.eye = fill.eye));

    this.outline.visible = outline > 0;
    if (outline > 0) {
      const units = outline / (pxPerUnit * (this.size / 100));
      this.outline.children.forEach((c, k) => c.position.set([units, -units, 0, 0][k]!, [0, 0, units, -units][k]!));
    }

    // The body: the meeting's move (translate, rotate, scale), then the walk cycle, about the feet.
    const m = this.moment;
    const move = m && this.stillSince !== null && !reduced ? moveAt(m.kind, m.face, m.turn, m.count, now, now - this.stillSince, m.leaving) : null;
    aff.reset();
    if (move) aff.translate(move.tx * this.size, move.ty * this.size).rotate(move.rot).scale(move.sx, move.sy);
    const { lift, rotate, squash } = this.stride;
    aff.translate(0, -lift * this.size * 0.13).rotate(rotate).scale(1 + squash, 1 - squash);
    put(this.body, aff);
    this.shadow.setSize(this.size * 0.6 * (1 - 0.35 * lift), this.size * 0.18 * (1 - 0.35 * lift));
  }

  /** Whether screen point (x, y) lands on its drawn silhouette. */
  hits(x: number, y: number, ctx: CanvasRenderingContext2D): boolean {
    const p = this.bob.toLocal({ x, y });
    return this.fig.hit.some((path) => ctx.isPointInPath(path, p.x, p.y));
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}

/** The world: one per scene. Everything in pack px under the camera. */
export class World {
  private readonly lit = new Container();
  private readonly clouds = new Container();
  private readonly cloudSprites: Sprite[] = [];
  private readonly camera = new Container();
  /** The base-level tiles, below everything, back to front. */
  private readonly ground = new Container({ isRenderGroup: true, sortableChildren: true });
  private readonly nests = new Graphics();
  /** Raised blocks, bridges, decor and blobs, by depth. */
  private readonly sorted = new Container({ sortableChildren: true });
  private readonly dots = new Container();
  private bake: Sprite | null = null;
  private readonly night = new ColorMatrixFilter({ antialias: "inherit" });
  /** Rain, snow, petals, fireflies…, over everything. */
  readonly sky: Sky;
  private chunks = new Map<string, Chunk>();
  private readonly mounted = new Map<string, Sprite[]>();
  private island: IslandGeometry | null = null;
  private generation = 0;
  private map = false;
  readonly blobs = new Map<string, BlobView>();
  private readonly dotSprites = new Map<string, Sprite>();
  private readonly hitCtx = document.createElement("canvas").getContext("2d")!;
  /** The camera: screen px per pack px, and where pack (0, 0) lands on screen. */
  scale = 1;
  private offset = { x: 0, y: 0 };

  private constructor(readonly app: Application) {
    this.camera.addChild(this.ground, this.nests, this.sorted, this.dots);
    this.dots.visible = false;
    this.lit.addChild(this.clouds, this.camera);
    this.sky = new Sky(app.renderer);
    app.stage.addChild(this.lit, this.sky.root);
    for (const _ of CLOUDS) {
      const sprite = new Sprite();
      this.cloudSprites.push(sprite);
      this.clouds.addChild(sprite);
    }
    this.loadClouds();
  }

  private greyClouds = false;
  private snowyTerrain = false;
  private gloomy = false;
  /** Grey clouds over snow, or under a grey sky. */
  private greyIfNeeded() {
    if ((this.snowyTerrain || this.gloomy) === this.greyClouds) return;
    this.greyClouds = !this.greyClouds;
    this.loadClouds();
  }
  private loadClouds() {
    CLOUDS.forEach((c, k) => {
      const src = cloudSrc(c.kind, this.greyClouds);
      // Unless the sky changed again while it loaded.
      void textureOf(src).then((t) => cloudSrc(c.kind, this.greyClouds) === src && (this.cloudSprites[k]!.texture = t));
    });
  }

  static async create(host: HTMLElement): Promise<World> {
    const app = new Application();
    await app.init({
      preference: "webgl",
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      width: host.clientWidth || 1,
      height: host.clientHeight || 1,
      autoStart: false,
      sharedTicker: false,
    });
    // The scene draws a frame when it has one to draw: no ticker of Pixi's own.
    app.ticker.stop();
    app.canvas.className = "pointer-events-none absolute inset-0";
    host.prepend(app.canvas);
    return new World(app);
  }

  resize(w: number, h: number) {
    this.app.renderer.resize(Math.max(1, w), Math.max(1, h));
  }

  /** The chunks and where they reach, for deciding what's in view. */
  get chunkBounds(): ReadonlyMap<string, Chunk> {
    return this.chunks;
  }

  /**
   * A new layout: its sprites are loaded before it replaces the old one, so
   * an edit never flashes an empty island. Resolves once it's shown.
   */
  async setTerrain(layout: IslandLayout, island: IslandGeometry, nests: { x: number; y: number; r: number }[]): Promise<void> {
    const generation = ++this.generation;
    this.snowyTerrain = snowy(layout);
    this.greyIfNeeded();
    const chunks = terrainOf(layout, island);
    const srcs = new Map<string, number>();
    for (const chunk of chunks.values()) for (const item of chunk.items) srcs.set(item.src, item.w);
    await Promise.all([...srcs].map(([src, w]) => textureOf(src, w)));
    if (generation !== this.generation) return;
    const keys = [...this.mounted.keys()];
    for (const key of keys) this.unmount(key);
    this.bake?.destroy({ texture: true, textureSource: true });
    this.bake = null;
    this.chunks = chunks;
    this.island = island;
    // Baked now, with every texture at hand, so the map shows at once when asked for.
    this.bakeIsland();
    // The nests, flat on the ground over exactly the squares blobs sleep in.
    this.nests.clear();
    const tiles = layout.size;
    for (const nest of nests) {
      const at = island.at(nest.x * tiles, nest.y * tiles);
      drawNest(this.nests, at.x, at.y + nest.r * tiles * HALF_H * 0.15, nest.r * 2 * tiles * 2 * HALF_W + 40);
    }
    for (const key of keys) if (chunks.has(key)) this.mount(key);
    if (this.map) this.setMap(true);
  }

  /** Mounts the chunks in `keys` and drops the rest. */
  showChunks(keys: Iterable<string>) {
    const want = new Set(keys);
    for (const key of [...this.mounted.keys()]) if (!want.has(key)) this.unmount(key);
    for (const key of want) if (!this.mounted.has(key)) this.mount(key);
  }

  /** Shows a chunk: in this frame when its textures are loaded (the usual case), else once they are. */
  private mount(key: string) {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    const sprites: Sprite[] = [];
    this.mounted.set(key, sprites);
    const ready = chunk.items.map((item) => loadedTextures.get(item.src));
    if (ready.every((t) => t !== undefined)) return this.place(chunk, sprites, ready as Texture[]);
    void Promise.all(chunk.items.map((item) => textureOf(item.src))).then((loaded) => {
      // Dropped (or the terrain replaced) while loading.
      if (this.mounted.get(key) === sprites) this.place(chunk, sprites, loaded);
    });
  }

  private place(chunk: Chunk, sprites: Sprite[], loaded: Texture[]) {
    chunk.items.forEach((item, k) => {
      const sprite = terrainSprite(item, loaded[k]!);
      if (item.z === 0) {
        sprite.zIndex = item.seq;
        this.ground.addChild(sprite);
      } else {
        // Ties in depth go in drawing order, and under the blobs of the same depth.
        sprite.zIndex = item.z + item.seq * 1e-6;
        this.sorted.addChild(sprite);
      }
      sprites.push(sprite);
    });
  }

  private unmount(key: string) {
    for (const sprite of this.mounted.get(key) ?? []) sprite.destroy();
    this.mounted.delete(key);
  }

  /** The zoomed-out map: the baked island and a dot per blob, instead of chunks and blobatars. */
  setMap(map: boolean) {
    this.map = map;
    this.dots.visible = map;
    if (this.bake) this.bake.visible = map;
  }

  /** The whole island in one picture, for the map. Only big islands have a map. */
  private bakeIsland() {
    const island = this.island;
    if (!island || this.chunks.size * CHUNK * CHUNK <= MAP_CELLS) return;
    const scale = Math.min(BAKE_PX / island.w, BAKE_PX / island.h);
    const target = RenderTexture.create({ width: Math.round(island.w * scale), height: Math.round(island.h * scale), autoGenerateMipmaps: true });
    const items = [...this.chunks.values()].flatMap((c) => c.items).sort((a, b) => a.z - b.z || a.seq - b.seq);
    const bake = new Sprite(target);
    bake.scale.set(1 / scale);
    bake.visible = this.map;
    this.bake = bake;
    this.camera.addChildAt(bake, 0);
    // Every texture was loaded with the terrain.
    const all = new Container();
    for (const item of items) all.addChild(terrainSprite(item, loadedTextures.get(item.src) ?? Texture.EMPTY));
    all.scale.set(scale);
    this.app.renderer.render({ container: all, target, clear: true });
    // Shown shrunk: the smaller copies the GPU reads from have to be made again from what was drawn.
    target.source.updateMipmaps();
    all.destroy({ children: true });
  }

  /** Screen px per pack px, and where pack (0, 0) lands on screen. */
  setCamera(scale: number, x: number, y: number) {
    if (scale !== this.scale) for (const dot of this.dotSprites.values()) dot.scale.set(1 / (4 * scale));
    this.scale = scale;
    this.offset = { x, y };
    this.camera.scale.set(scale);
    this.camera.position.set(x, y);
  }

  /**
   * The clouds drift across the scene (`w` x `h` px) and zoom half as much as
   * the ground around the camera's centre (`cx`, `cy`, zoom `z`, in the
   * scene's px).
   */
  setClouds(w: number, h: number, cx: number, cy: number, z: number, now: number, reduced: boolean) {
    const zc = 1 + (z - 1) * CLOUD_PARALLAX;
    this.clouds.position.set(w / 2 - cx * zc, h / 2 - cy * zc);
    this.clouds.scale.set(zc);
    CLOUDS.forEach((c, k) => {
      const sprite = this.cloudSprites[k]!;
      const t = (((now / 1000 / c.duration + c.offset) % 1) + 1) % 1;
      sprite.position.set(reduced ? c.offset * w : -0.25 * w + 1.3 * w * t, (c.top / 100) * h);
      if (sprite.texture.width > 1) sprite.setSize((c.size / 100) * w, ((c.size / 100) * w * sprite.texture.height) / sprite.texture.width);
    });
  }

  /**
   * Daylight in [0, 1]: night dims and desaturates the world, and the clouds
   * fade. `gloom` in [0, 1], a grey sky's, dims it a little too, and greys
   * the clouds.
   */
  setLight(light: number, gloom = 0) {
    for (const sprite of this.cloudSprites) sprite.alpha = Math.min(1, (0.4 + 0.6 * light) * (1 + 0.5 * gloom));
    const seen = light * (1 - 0.3 * gloom);
    this.night.matrix = nightMatrix(seen) as ColorMatrixFilter["matrix"];
    // No pass at all on a clear day.
    this.lit.filters = seen >= 1 ? null : this.night;
    this.gloomy = gloom >= 0.5;
    this.greyIfNeeded();
  }

  /** The blob `seed`, drawn from now on. */
  blob(seed: string): BlobView {
    let view = this.blobs.get(seed);
    if (!view) {
      view = new BlobView(seed);
      this.blobs.set(seed, view);
      this.sorted.addChild(view.root);
    }
    return view;
  }

  dropBlob(seed: string) {
    this.blobs.get(seed)?.destroy();
    this.blobs.delete(seed);
  }

  /** The dot for `seed` on the map, at pack (x, y). */
  dot(seed: string, home: boolean, x: number, y: number) {
    let dot = this.dotSprites.get(seed);
    if (!dot) {
      dot = new Sprite(dotOf(home));
      dot.anchor.set(0.5);
      dot.scale.set(1 / (4 * this.scale));
      this.dotSprites.set(seed, dot);
      this.dots.addChild(dot);
    }
    dot.position.set(x, y);
  }

  dropDot(seed: string) {
    this.dotSprites.get(seed)?.destroy();
    this.dotSprites.delete(seed);
  }

  /** Only these blobs have a dot on the map. */
  keepDots(seeds: ReadonlySet<string>) {
    for (const seed of [...this.dotSprites.keys()]) if (!seeds.has(seed)) this.dropDot(seed);
  }

  /** Every blob under screen point (x, y), frontmost first. */
  blobsAt(x: number, y: number): string[] {
    return [...this.blobs.values()]
      // Most blobs are nowhere near: skip them on distance before testing their shapes.
      .filter((view) => {
        const { tx, ty } = view.root.worldTransform;
        return Math.hypot(tx - x, ty - y) < view.size * this.scale * 1.5 && view.hits(x, y, this.hitCtx);
      })
      .sort((a, b) => b.root.zIndex - a.root.zIndex)
      .map((view) => view.seed);
  }

  /** The map dot under screen point (x, y), if any. */
  dotAt(x: number, y: number): string | null {
    if (!this.map) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [seed, dot] of this.dotSprites) {
      const [sx, sy] = [dot.x * this.scale + this.offset.x, dot.y * this.scale + this.offset.y];
      const d = Math.hypot(sx - x, sy - y);
      if (d <= dot.texture.width / 8 + 2 && d < bestD) [best, bestD] = [seed, d];
    }
    return best;
  }

  render() {
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    this.generation++;
    for (const key of [...this.mounted.keys()]) this.unmount(key);
    for (const view of this.blobs.values()) view.destroy();
    this.bake?.destroy({ texture: true, textureSource: true });
    this.sky.destroy();
    // Shared textures and shapes stay loaded, for the next world.
    this.app.destroy({ removeView: true }, { children: true });
  }
}
