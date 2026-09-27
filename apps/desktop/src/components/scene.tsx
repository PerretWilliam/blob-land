import { daylight, flagOf, legIn, NEST, segmentAt, type Activity, type Attraction, type GroundPoint, type Identity, type Segment, type Sex } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import * as EXPRESSIONS from "blobatar/expression";
import { happy, idle, love, mad, sad, scared, shy, sleepy, smug, surprised, thinking, unsure, wink, type Expression } from "blobatar/expression";
import { Coffee, Footprints, HeartHandshake, Moon, Sparkles, Sunrise, Users, X } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ATTRACTION_LABELS, BlobGenderSign, IdentityFields, SEX_LABELS } from "@/components/blob-gender";
import { Button } from "@/components/ui/button";
import { CountryField, countryName } from "@/components/country-field";
import { AuraFx, InteractionFx, momentAt, type Aura, type Moment } from "@/components/interaction-fx";
import cloudLarge from "@/assets/iso/cloud-large.png";
import cloudSmall from "@/assets/iso/cloud-small.png";
import DECOR_WIDTHS from "@/assets/iso/widths.json";
import {
  canHoldDecor,
  cellAt,
  DECOR_KINDS,
  EDGES,
  findPath,
  isSunken,
  nestCell,
  OPPOSITE_EDGE,
  rampDirection,
  snapToGround,
  surfaceHeight,
  type DecorKind,
  type Ground,
  type IslandLayout,
} from "@/lib/island";
import { useInView } from "@/lib/motion";

export interface SceneBlob {
  seed: string;
  label: string;
  /** Its stored timeline around now, sorted by start: played back for where it walks. */
  segments: Segment[];
  expression: Expression;
  /** What it's doing right now, shown as an icon next to its name. */
  activity?: Activity;
  sex: Sex;
  attraction: Attraction;
  /** Who it's meeting right now, by name, while its activity is "meet". */
  meetingWith?: string;
  /** Its other half, if it's in a couple: they wander together when both are free. */
  partner?: string | null;
  /** Its partner's display name, for the ID card. */
  partnerLabel?: string;
  /** Still a child. */
  young?: boolean;
  /** Something that just happened to it, shown over its head for a while. */
  aura?: Aura;
  /** Set on the player's own blob: lets them change who it is from its ID card. */
  onIdentityChange?: (identity: Identity) => void;
  /** Where its player is from (ISO code), if they share it: a flag by its name. */
  country?: string | null;
  /** Set on the player's own garden blob: lets them pick or drop their country. */
  onCountryChange?: (country: string | null) => void;
}

/** A stored expression name as blobatar's expression object. */
export const expressionNamed = (name: string): Expression =>
  (EXPRESSIONS as unknown as Record<string, Expression | undefined>)[name] ?? idle;

/** What a blob is doing and wearing at `t`, read off its timeline. */
export function blobStateAt(segments: readonly Segment[], t: number): { activity: Activity; expression: Expression; since: number } {
  const seg = segmentAt(segments, t)?.seg;
  if (!seg) return { activity: "rest", expression: idle, since: t };
  return { activity: seg.activity, expression: expressionNamed(seg.expression), since: seg.start };
}

export interface SceneProps {
  blobs: SceneBlob[];
  reducedMotion: boolean;
  /** The walkable ground: which cells are water, what stands where. */
  layout: IslandLayout;
  /** Edit mode: when set, cells become clickable and report their index. */
  onCellPaint?: (cell: number) => void;
  /** Blob size as a fraction of one tile's width, so blobs keep their
   * proportions to the ground at any window size. */
  blobScale?: number;
  /** The time timelines are played back at (and the sky follows): real
   * time, or the garden's own clock, which may run faster (dev). */
  clock?: () => number;
  /** Shows a "See relations" button on a blob's ID card. */
  onShowRelations?: (seed: string, name: string) => void;
  /** On a map too big to show whole, the blob the camera starts on. */
  startAt?: string;
}

// Half the distance two partners keep between them, per ground axis.
const PAIR_GAP = 0.04;
// Past 8 tiles a side, ground units cover more tiles: slow walks (and pull
// couples closer) by as much, so blobs keep their pace and spacing per tile.
const walkZoom = (tiles: number) => Math.max(1, tiles / 8);
// How many tiles fit across the screen at the camera's starting zoom, on a
// big map; smaller maps start fully in view.
const TILES_IN_VIEW = 14;
/*
 * On a big map only what the camera sees is in the DOM: the ground in
 * CHUNK x CHUNK squares, and the blobs near the screen. Past DOM_CELLS cells
 * in view, the map switches to one baked picture of the whole island with
 * blobs as dots, which is all you can make out from that far anyway.
 */
const CHUNK = 8;
const DOM_CELLS = 2000;
// Sprites reach this far past the grid points they hang off (trees, stacks), in pack px.
const CHUNK_PAD = 420;
// The baked picture's longest side, in canvas px: sharp enough for the whole-map view.
const BAKE_PX = 4096;
// Out of view, a blob's position is refreshed once every this many frames.
const OFFSCREEN_EVERY = 20;
// Seconds for the displayed position to close ~63% of the gap to the computed
// one. Hides frame-to-frame steps and absorbs discrete jumps (a new pairing).
const EASE_S = 0.6;
// Walk cycle: hops per second while moving, and how fast the gait fades in/out.
const HOP_HZ = 2.4;
const GAIT_EASE_S = 0.25;
// Below this ground speed (units/s) a blob counts as standing still: it's
// where the position easing's long tail ends, not a real step.
const WALK_SPEED = 0.006;
// Above this speed a blob hops; below it waddles. 99% of a stroll stays under
// 0.036, so only long, quick crossings (and catch-ups like a new pairing) hop.
const HOP_SPEED = 0.045;
// Camera: how far it zooms onto a selected blob, and how softly it moves.
const FOCUS_ZOOM = 2;
// On a big map, following a blob shows about this many tiles across.
const FOCUS_TILES = 6;
// The most the island is laid out bigger than fitting the screen (see `res`).
const MAX_RES = 16;
// Clouds zoom this fraction as much as the ground: farther away, so they move less.
const CLOUD_PARALLAX = 0.5;
const CAMERA_EASE_S = 0.45;

/*
 * Tile geometry, in the sprite pack's own pixels: tiles are true isometric
 * (diamond ratio ~sqrt(3), not 2:1). One grid step is half a diamond, and
 * outlines overlap so neighbours share an edge. Every block piece (tiles,
 * roads, rivers, ramps) is exported on the same 304 x 296 canvas, bottom
 * aligned, with the top vertex's outline centre 152px in and 15.3px down.
 */
const HALF_W = 139;
const HALF_H = 81;
const TILE_IMG_W = 304;
const TOP_X = 152;
const TOP_Y = 15.3;
const SIDE_H = 109;
// One block of height: a stacked block sits this much higher on screen.
const LEVEL = 109;
// Water's surface sits this much below the banks (tile-water is that much
// shorter than a grass block): a blob stepping in wades.
const WATER_DROP = 28;
const PAD = 8;

/*
 * The island is `tiles` rows by `tiles + 1` columns: the extra column along
 * the right-hand front edge is a stream, outside the walkable [0, 1]² square
 * positionAt covers, so nobody ever walks on water. `lift` is the tallest
 * stack in blocks, which needs room above the back row.
 */
function islandGeometry(tiles: number, lift: number) {
  const cols = tiles + 1;
  const rows = tiles;
  const top = PAD + lift * LEVEL;
  const w = (cols + rows) * HALF_W + 2 * PAD;
  const h = (cols + rows) * HALF_H + SIDE_H + PAD + top;
  // Grid point (u, v), in tile units, at `height` blocks -> % of the island box.
  const at = (u: number, v: number, height = 0) => ({
    left: ((PAD + rows * HALF_W + (u - v) * HALF_W) / w) * 100,
    top: ((top + (u + v) * HALF_H - height * LEVEL) / h) * 100,
  });
  return { cols, rows, w, h, at };
}

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const mix = (a: string, b: string, p: number) =>
  `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i]! - v) * p)).join(" ")})`;

const SKY = { night: ["#0b1026", "#27305a"], dusk: ["#3b3f78", "#f2a07b"], day: ["#4fb8f0", "#d8f1ff"] };

function skyGradient(d: number): string {
  const [from, to, p] = d < 0.5 ? [SKY.night, SKY.dusk, d * 2] : [SKY.dusk, SKY.day, (d - 0.5) * 2];
  return `linear-gradient(to bottom, ${mix(from[0]!, to[0]!, p)}, ${mix(from[1]!, to[1]!, p)})`;
}

// Fixed decor — ambience only, no behaviour. Positions are ground coordinates;
// `w` is the sprite's native width, so every sprite keeps the pack's own scale.
const STARS = [
  [8, 12], [17, 30], [26, 8], [38, 22], [47, 5], [55, 34], [63, 14], [72, 27], [81, 9], [90, 20], [95, 38], [33, 40],
];
const CLOUDS = [
  { src: cloudLarge, top: 6, size: 16, duration: 240, offset: 0.1 },
  { src: cloudSmall, top: 20, size: 10, duration: 190, offset: 0.55 },
  { src: cloudSmall, top: 2, size: 8, duration: 280, offset: 0.8 },
];
// Sprites are exported at 2x from the pack's SVG (sharp when the camera zooms);
// `w` is the native width, in the same pack pixels as the tile geometry.
const DECOR_FILES = import.meta.glob<string>("../assets/iso/{tree,bush,rock,cactus}-*.png", { eager: true, import: "default" });
export const DECOR_SPRITES = Object.fromEntries(
  DECOR_KINDS.map((kind) => [
    kind,
    { src: DECOR_FILES[`../assets/iso/${kind}.png`]!, w: (DECOR_WIDTHS as Record<string, number>)[kind]! },
  ]),
) as Record<DecorKind, { src: string; w: number }>;

// Block pieces, by file name: tile-<ground>, road|river[-sand|-snow]-<edges>,
// ramp[-road][-sand|-snow]-<direction>.
const PIECES = import.meta.glob<string>("../assets/iso/{tile,road,river,ramp}-*.png", { eager: true, import: "default" });
const piece = (name: string) => PIECES[`../assets/iso/${name}.png`]!;

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

/*
 * Road and river pieces are named by the tile edges they open onto (EDGES:
 * nw = (i-1, j), ne = (i, j-1), se = (i+1, j), sw = (i, j+1)), so corners,
 * junctions and dead ends lay themselves out from the neighbours. Rivers also
 * run into water, including the stream along the front edge.
 */
function linkedEdges(layout: IslandLayout, i: number, j: number, ground: "road" | "river"): string {
  const height = cellAt(layout, i, j)?.height ?? 0;
  const edges = EDGES.filter(([edge, di, dj]) => {
    const [a, b] = [i + di, j + dj];
    if (ground === "river" && a === layout.size && b >= 0 && b < layout.size) return true;
    const neighbour = cellAt(layout, a, b);
    if (!(neighbour?.ground === ground || (ground === "river" && neighbour?.ground === "water"))) return false;
    const neighbourHeight = neighbour?.height ?? 0;
    const rampEdge = rampDirection(layout, a, b);
    // Level ground: a ramp only opens onto its flat (low) front, never its side walls.
    if (neighbourHeight === height) return !rampEdge || rampEdge === edge;
    // One block up: only where the ramp actually climbs up to us.
    if (neighbourHeight === height - 1) return rampEdge === OPPOSITE_EDGE[edge];
    return false;
  }).map(([edge]) => edge);
  return (edges.length ? edges : ["nw", "se"]).join("-");
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
  const dir = rampDirection(layout, i, j);
  const stack = Array.from({ length: height }, () => block);
  if (dir) {
    const material = ground === "road" ? `-road${bank}` : ground === "grass" ? "" : `-${ground}`;
    return [...stack, block, piece(`ramp${material}-${dir}`)];
  }
  const top =
    ground === "road" || ground === "river"
      ? piece(`${ground}${bank}-${linkedEdges(layout, i, j, ground)}`)
      : piece(`tile-${ground}`);
  return [...stack, top];
}

/** Thumbnails for the editor's tools. */
export const GROUND_THUMBS = Object.fromEntries(
  (["grass", "sand", "dirt", "snow", "water", "ice"] as const).map((g) => [g, piece(`tile-${g}`)]),
) as Record<Ground, string>;
GROUND_THUMBS.road = piece("road-nw-se");
GROUND_THUMBS.river = piece("river-nw-se");
export const RAMP_THUMB = piece("ramp-nw");

/** How far along a `findPath` walk a blob has got at progress `e` in [0, 1]:
 * arc-length along the route, not a straight-line lerp, so a walk bends
 * around cliffs and water instead of cutting through them. */
function alongPath(path: GroundPoint[], e: number): GroundPoint {
  if (path.length < 2) return path[0] ?? { x: 0.5, y: 0.5 };
  const lens = path.slice(1).map((p, k) => Math.hypot(p.x - path[k]!.x, p.y - path[k]!.y));
  const total = lens.reduce((a, b) => a + b, 0);
  if (total === 0) return path[path.length - 1]!;
  let left = e * total;
  for (let k = 0; k < lens.length; k++) {
    const len = lens[k]!;
    if (left <= len || k === lens.length - 1) {
      const [a, b] = [path[k]!, path[k + 1]!];
      const f = len === 0 ? 0 : Math.min(1, left / len);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= len;
  }
  return path[path.length - 1]!;
}

// Free to wander off with a partner: not asleep, not busy with someone else.
const FREE = new Set<Activity>(["explore", "rest", "discover"]);

/**
 * Where each blob should stand at `t`, played back from its timeline and
 * routed around cliffs and water. A couple who are both free walks together,
 * converging on the midpoint of their two own positions.
 */
function targets(layout: IslandLayout, blobs: SceneBlob[], t: number, segmentsOf = new Map(blobs.map((b) => [b.seed, b.segments]))): GroundPoint[] {
  const snap = (p: GroundPoint) => snapToGround(layout, p);
  const zoom = walkZoom(layout.size);
  const gap = PAIR_GAP / zoom;
  const ps = blobs.map((b) => {
    const at = segmentAt(b.segments, t, snap);
    if (!at) return { x: 0.5, y: 0.5 };
    if (t >= at.seg.end) return snap({ x: at.seg.x, y: at.seg.y });
    const spot = at.seg.activity === "meet" ? meetingSpot(at.seg, t, segmentsOf, snap) : null;
    const { from, to, e } = legIn(at.seg, at.from, t, spot ? () => spot : snap, zoom);
    return alongPath(findPath(layout, from, to), e);
  });
  const index = new Map(blobs.map((b, i) => [b.seed, i]));
  const clamp = (v: number) => Math.min(1 - gap, Math.max(gap, v));
  blobs.forEach((b, i) => {
    const j = b.partner ? index.get(b.partner) : undefined;
    if (j === undefined || b.seed > blobs[j]!.seed) return;
    const [sa, sb] = [segmentAt(b.segments, t)?.seg, segmentAt(blobs[j]!.segments, t)?.seg];
    if (!sa || !sb || !FREE.has(sa.activity) || !FREE.has(sb.activity)) return;
    const mid = { x: clamp((ps[i]!.x + ps[j]!.x) / 2), y: clamp((ps[i]!.y + ps[j]!.y) / 2) };
    // Side by side along the screen's horizontal, so neither hides the other.
    ps[i] = { x: mid.x - gap, y: mid.y + gap };
    ps[j] = { x: mid.x + gap, y: mid.y - gap };
  });
  return ps;
}

/**
 * Where a blob stands in a meeting: the spot the sim gave it, moved along
 * with the whole gathering if its middle isn't somewhere blobs can stand (a
 * tree, water). Snapping each blob on its own would scatter them.
 *
 * ponytail: the walk into the next segment starts from the unmoved spot, a
 * small hop when a gathering had to move; carry the offset over if it shows.
 */
function meetingSpot(seg: Segment, t: number, segmentsOf: Map<string, Segment[]>, snap: (p: GroundPoint) => GroundPoint): GroundPoint {
  const spots = [seg, ...(seg.with ?? []).flatMap((s) => segmentAt(segmentsOf.get(s) ?? [], t)?.seg ?? [])].filter((x) => x.end === seg.end);
  const mid = { x: spots.reduce((a, x) => a + x.x, 0) / spots.length, y: spots.reduce((a, x) => a + x.y, 0) / spots.length };
  const moved = snap(mid);
  return { x: moved.x + seg.x - mid.x, y: moved.y + seg.y - mid.y };
}

/*
 * Depth order. Everything on cell diagonal d = i + j sits in its own band
 * [10 + 1000d, 10 + 1000(d+1)): the blocks raised above the base level at the
 * bottom of the band, then what stands on the cell, back to front. So a hill
 * hides blobs behind it and never the ones in front or on top. The base-level
 * tiles stay below every band, painted back to front by DOM order.
 */
const cellZ = (d: number) => 10 + d * 1000;
/** One ground or decor sprite, where the terrain puts it (see `sprite`). */
interface TerrainSprite {
  key: string;
  /** The cell it belongs to, for chunking. */
  i: number;
  j: number;
  src: string;
  at: { left: number; top: number };
  /** Native width, in pack px. */
  w: number;
  z: number;
  /** Anchored at its base rather than its top-left corner. */
  decor: boolean;
}

function depthZ(tiles: number, p: GroundPoint) {
  const [u, v] = [p.x * tiles, p.y * tiles];
  const [i, j] = [Math.min(tiles - 1, Math.floor(u)), Math.min(tiles - 1, Math.floor(v))];
  return cellZ(i + j) + 1 + Math.round((u - i + (v - j)) * 490);
}

export function Scene({ blobs, reducedMotion, layout, onCellPaint, blobScale = 0.6, clock = Date.now, onShowRelations, startAt }: SceneProps) {
  const tiles = layout.size;
  // Fitting the whole map is zoom 1; how far in the camera starts, and follows a blob.
  const baseZoom = Math.max(1, tiles / TILES_IN_VIEW);
  const focusZoom = Math.max(FOCUS_ZOOM, tiles / FOCUS_TILES);
  const [sceneRef, sceneInView] = useInView();
  const clockRef = useRef(clock);
  clockRef.current = clock;
  // Read on each render: the screen re-renders on its own tick.
  const now = clock();
  const light = daylight(now);

  const lift = Math.max(0, ...layout.cells.map((c) => (c.height ?? 0) + (c.ramp ? 1 : 0)));
  const island = islandGeometry(tiles, lift);
  const ground = (p: GroundPoint) => island.at(p.x * tiles, p.y * tiles);
  const islandGeomRef = useRef(island);
  islandGeomRef.current = island;

  // The loop reads the latest props through refs and writes position straight
  // to the DOM, so a garden refresh doesn't restart it and frames don't re-render React.
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  // Everyone's timeline by seed, for meetings, whoever is being moved this frame.
  const segmentsOfRef = useRef(new Map<string, Segment[]>());
  segmentsOfRef.current = useMemo(() => new Map(blobs.map((b) => [b.seed, b.segments])), [blobs]);
  const groundRef = useRef(ground);
  groundRef.current = ground;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // How high a blob's feet are, in pack px: up hills and ramps, and down into
  // water, where it wades.
  const liftAt = (p: GroundPoint) => {
    const [u, v] = [p.x * tiles, p.y * tiles];
    const [i, j] = [Math.min(tiles - 1, Math.floor(u)), Math.min(tiles - 1, Math.floor(v))];
    const g = cellAt(layout, i, j)?.ground;
    return surfaceHeight(layout, i, j, u, v) * LEVEL - (g && isSunken(g) ? WATER_DROP : 0);
  };
  const liftRef = useRef(liftAt);
  liftRef.current = liftAt;
  const islandRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const cloudsRef = useRef<HTMLDivElement>(null);
  // Click a blob to zoom onto it and follow it; click anywhere else (or Escape) to zoom back out.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const camera = useRef<{ x: number; y: number; z: number } | null>(null);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);
  /*
   * Zooming in scales the world with a transform, which only magnifies what
   * was already drawn: blurry past ×1.5 or so. So the island is also laid out
   * `res` times bigger (a power of two near the zoom) and the transform only
   * makes up the difference; everything gets redrawn sharp at each step.
   * Camera coordinates stay those of the island at `res` 1 ("fit" px).
   */
  const [res, setRes] = useState(1);
  const resRef = useRef(1);
  const resWanted = useRef(1);
  // The island is sized by CSS from the window; blobs follow its tile width.
  const [fitPx, setFitPx] = useState(0);
  /*
   * The island box and the camera's sizes, read once per resize. The frame
   * loop writes transforms; reading a size after that would force a layout
   * per blob per frame. `bw`/`bh`: the box as laid out (res included);
   * `w`/`h`/`left`/`top`: the box in fit px, in the camera's coordinates
   * (it's centred with a -50%/-50% translate that offsetLeft/Top ignore,
   * which keeps its centre `cx`/`cy` put whatever `res`).
   */
  const size = useRef({ bw: 0, bh: 0, w: 0, h: 0, cx: 0, cy: 0, left: 0, top: 0, camW: 0, camH: 0 });
  function measure() {
    const [box, cam] = [islandRef.current, cameraRef.current];
    if (!box || !cam) return;
    const [bw, bh, r] = [box.clientWidth, box.clientHeight, resRef.current];
    const [w, h, cx, cy] = [bw / r, bh / r, box.offsetLeft, box.offsetTop];
    size.current = { bw, bh, w, h, cx, cy, left: cx - w / 2, top: cy - h / 2, camW: cam.clientWidth, camH: cam.clientHeight };
    setFitPx(w);
  }
  useLayoutEffect(() => {
    const [box, cam] = [islandRef.current, cameraRef.current];
    if (!box || !cam) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(cam);
    return () => observer.disconnect();
  }, []);
  // A new layout size: measure it now, before the next frame places anything.
  useLayoutEffect(() => {
    resRef.current = res;
    measure();
  }, [res]);
  // In the box's own px, like everything inside it.
  const blobSize = res * Math.max(32 / baseZoom, Math.round(((fitPx * 2 * HALF_W) / island.w) * blobScale));
  const blobSizeRef = useRef(blobSize);
  blobSizeRef.current = blobSize;
  // Per blob: the anchor (moved), its hopping body and shadow, and its label.
  const els = useRef(new Map<string, { el: HTMLElement; body: HTMLElement | null; shadow: HTMLElement | null }>());
  const labels = useRef(new Map<string, HTMLElement>());
  // `phase` drives the gait; `walk` in [0, 1] is how much the blob is walking,
  // eased so a stop settles instead of freezing mid-air; `hop` in [0, 1] is how
  // much of that walk is hopping rather than waddling; `lean` tilts it.
  type Gait = { phase: number; walk: number; hop: number; lean: number };
  const gait = useRef(new Map<string, Gait>());
  // `lift`: how high the feet are (see liftAt), eased like x/y so stepping
  // into water or up a cliff is a quick slide rather than a jump.
  const shown = useRef(new Map<string, GroundPoint & { lift: number }>());

  /*
   * Moving blobs go through `transform`, not `left`/`top`: a transform is
   * composited at sub-pixel precision, while `left`/`top` re-run layout each
   * frame and WebKit (Tauri's webview on macOS) snaps them to whole pixels —
   * which is what made the walk stutter.
   */
  /** A blob's feet, in px from the island box's top-left corner. */
  function blobPx(p: GroundPoint & { lift: number }) {
    const { left, top } = groundRef.current(p);
    const { bw, bh } = size.current;
    return { x: (left / 100) * bw, y: (top / 100) * bh - (p.lift * bh) / islandGeomRef.current.h };
  }

  function applyPosition(seed: string, p: GroundPoint & { lift: number }) {
    const box = islandRef.current;
    if (!box) return;
    const { x, y } = blobPx(p);
    const at = `translate3d(${x}px, ${y}px, 0)`;
    const blob = els.current.get(seed);
    if (blob) {
      blob.el.style.transform = at;
      // The one being followed comes to the front, even from behind a crowd (names stay above).
      blob.el.style.zIndex = String(seed === selectedRef.current ? 199_999 : depthZ(tiles, p));
    }
    const label = labels.current.get(seed);
    if (label) label.style.transform = at;
  }

  /** Hop (or waddle), squash and lean the body; shrink the shadow while airborne. */
  function applyGait(seed: string, g: Gait) {
    const blob = els.current.get(seed);
    if (!blob?.body) return;
    const hop = g.walk * g.hop;
    const lift = Math.abs(Math.sin(g.phase)) * hop; // 0 on the ground, 1 at the top of a hop
    const squash = 0.09 * hop * (1 - Math.abs(Math.sin(g.phase))) ** 2; // flattens on landing
    const waddle = Math.sin(g.phase) * 4 * g.walk * (1 - g.hop); // side to side, feet on the ground
    blob.body.style.transform = `translate3d(0, ${-lift * blobSizeRef.current * 0.13}px, 0) rotate(${g.lean + waddle}deg) scale(${1 + squash}, ${1 - squash})`;
    if (blob.shadow) blob.shadow.style.transform = `translate(-50%, -50%) scale(${1 - 0.35 * lift})`;
  }

  /**
   * Blobs overlap. Clicking where several stand selects the one clicked, and
   * clicking again there goes to the next one behind it, round and round.
   */
  function pick(seed: string, at?: { x: number; y: number }) {
    if (at) {
      const stack = [
        ...new Set(document.elementsFromPoint(at.x, at.y).flatMap((el) => el.closest<HTMLElement>("[data-body]")?.dataset.seed ?? [])),
      ];
      const i = stack.indexOf(selectedRef.current ?? "");
      if (i >= 0 && stack.length > 1) return setSelected(stack[(i + 1) % stack.length]!);
    }
    setSelected(seed);
  }

  /*
   * Flags whether a blob has stopped walking, which starts its meeting
   * effects (see index.css). On arrival at a new meeting, its effects' clocks
   * are set to the page's time origin, so everyone at the meeting is in step:
   * speakers take turns instead of talking over each other.
   */
  function arrived(seed: string, still: boolean) {
    for (const el of [els.current.get(seed)?.el, labels.current.get(seed)]) {
      if (!el) continue;
      el.dataset.still = still ? "1" : "0";
      const key = el.dataset.fxKey ?? "";
      if (!still || el.dataset.synced === key) continue;
      el.dataset.synced = key;
      for (const a of el.getAnimations({ subtree: true })) if ((a as CSSAnimation).animationName?.startsWith("fx-")) a.startTime = 0;
    }
  }

  /*
   * The camera scales the whole world (island, blobs, labels — not the sky)
   * around a focus point: the selected blob, or the middle of the scene. It
   * eases like everything else, so following a walking blob stays smooth.
   */
  function applyCamera(k: number) {
    const cam = cameraRef.current;
    const { camW: w, camH: h, left, top } = size.current;
    if (!cam || !w) return;
    const r = resRef.current;
    // A blob's head, in fit px.
    const headOf = (p: GroundPoint & { lift: number }) => {
      const feet = blobPx(p);
      return { x: left + feet.x / r, y: top + (feet.y - blobSizeRef.current * 0.4) / r };
    };
    const seed = selectedRef.current;
    const p = seed ? shown.current.get(seed) : undefined;
    let target: { x: number; y: number; z: number };
    if (p && blobsRef.current.some((b) => b.seed === seed)) target = { ...headOf(p), z: focusZoom };
    else {
      if (!view.current) {
        const start = startAt ? shown.current.get(startAt) : undefined;
        view.current = start ? { ...headOf(start), z: baseZoom } : { x: w / 2, y: h / 2, z: baseZoom };
      }
      target = view.current = clampView(view.current);
    }
    const c = camera.current ?? target;
    const next = { x: c.x + (target.x - c.x) * k, y: c.y + (target.y - c.y) * k, z: c.z + (target.z - c.z) * k };
    camera.current = next;
    // The box is laid out `r` times bigger around its centre, so scale by what's left.
    const { cx, cy } = size.current;
    const [scale, grow] = [next.z / r, next.z * (1 - 1 / r)];
    cam.style.transform = `translate(${w / 2 - next.x * next.z + cx * grow}px, ${h / 2 - next.y * next.z + cy * grow}px) scale(${scale})`;
    // Re-lay out at the power of two nearest the zoom once the scale strays
    // too far from 1 (not at every step, so zooming doesn't keep relaying out).
    const want = Math.min(MAX_RES, 2 ** Math.round(Math.log2(Math.max(1, next.z))));
    if (want !== resWanted.current && Math.abs(Math.log2(scale)) > 0.6) {
      resWanted.current = want;
      setRes(want);
    }
    const clouds = cloudsRef.current;
    if (clouds) {
      const z = 1 + (next.z - 1) * CLOUD_PARALLAX;
      clouds.style.transform = `translate(${w / 2 - next.x * z}px, ${h / 2 - next.y * z}px) scale(${z})`;
    }
    // Labels divide by this to keep their on-screen size while zoomed.
    cam.style.setProperty("--camera-zoom", String(scale));
    cull();
  }

  /*
   * The camera the visitor steers when no blob is followed: drag to pan,
   * wheel (or +/-) to zoom around the pointer, arrows to pan. Kept over the
   * island, and between fitting it whole and the follow zoom.
   */
  const view = useRef<{ x: number; y: number; z: number } | null>(null);
  function clampView(v: { x: number; y: number; z: number }) {
    const { w, h, left, top } = size.current;
    if (!w) return v;
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    return { x: clamp(v.x, left, left + w), y: clamp(v.y, top, top + h), z: clamp(v.z, 1, focusZoom) };
  }
  /*
   * What's in view, updated by the frame loop only when it changes: which
   * ground chunks to mount, whether it's the zoomed-out map, and which blobs.
   * Empty until the first frame has placed the camera.
   */
  const culled = tiles * tiles > DOM_CELLS;
  const [inView, setInView] = useState({ chunks: [] as string[], map: false, blobs: new Set<string>() });
  const inViewRef = useRef(inView);
  const seesBlob = (seed: string) => inView.blobs.has(seed);
  /** The screen, in the island's pack px. */
  function viewRect() {
    const c = camera.current;
    const { w, left, top, camW, camH } = size.current;
    if (!c || !w) return null;
    const s = islandGeomRef.current.w / w;
    const [hw, hh] = [camW / 2 / c.z, camH / 2 / c.z];
    return { x0: (c.x - hw - left) * s, x1: (c.x + hw - left) * s, y0: (c.y - hh - top) * s, y1: (c.y + hh - top) * s };
  }
  function cull() {
    const r = viewRect();
    if (!r) return;
    const prev = inViewRef.current;
    let { chunks, map } = prev;
    if (culled) {
      const keys: string[] = [];
      for (const [key, b] of terrainRef.current.chunks) if (b.x1 > r.x0 && b.x0 < r.x1 && b.y1 > r.y0 && b.y0 < r.y1) keys.push(key);
      map = keys.length * CHUNK * CHUNK > DOM_CELLS;
      const next = map ? [] : keys;
      if (next.join() !== chunks.join()) chunks = next;
    }
    // Blobs a little past the edges too, so they're drawn before they walk in.
    const g = islandGeomRef.current;
    const pad = (blobSizeRef.current * 2 * g.w) / (size.current.bw || 1);
    const blobs = new Set<string>();
    for (const b of blobsRef.current) {
      const p = shown.current.get(b.seed);
      if (!p) continue;
      const at = groundRef.current(p);
      const [x, y] = [(at.left / 100) * g.w, (at.top / 100) * g.h - p.lift];
      if (x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad * 1.5) blobs.add(b.seed);
    }
    const sameBlobs = prev.blobs.size === blobs.size && [...blobs].every((seed) => prev.blobs.has(seed));
    if (chunks === prev.chunks && map === prev.map && sameBlobs) return;
    inViewRef.current = { chunks, map, blobs: sameBlobs ? prev.blobs : blobs };
    setInView(inViewRef.current);
  }
  // Where steering starts from: the camera itself while it follows a blob.
  const steerFrom = () => (selectedRef.current ? camera.current : (view.current ?? camera.current));
  /** Takes the camera back from a followed blob, from where it is now. */
  function steer(change: (v: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) {
    const from = steerFrom();
    if (!from) return;
    if (selectedRef.current) setSelected(null);
    view.current = clampView(change({ ...from }));
    if (reducedMotion) applyCamera(1);
  }
  // Set by a drag, so the click that ends it doesn't also select or deselect.
  const dragged = useRef(false);
  function startDrag(e: ReactPointerEvent) {
    if (onCellPaint || e.button !== 0) return;
    const [x0, y0] = [e.clientX, e.clientY];
    let from: { x: number; y: number; z: number } | null = null;
    const onMove = (m: PointerEvent) => {
      const [dx, dy] = [m.clientX - x0, m.clientY - y0];
      if (!from && Math.hypot(dx, dy) < 5) return;
      from ??= steerFrom();
      const f = from;
      if (f) steer(() => ({ x: f.x - dx / f.z, y: f.y - dy / f.z, z: f.z }));
    };
    const onUp = () => {
      dragged.current = from !== null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  /** Zooms by `factor`, keeping the point under screen position (sx, sy) in place. */
  function zoomAt(factor: number, sx: number, sy: number) {
    const { camW: w, camH: h } = size.current;
    steer((v) => {
      const z = Math.min(focusZoom, Math.max(1, v.z * factor));
      const [px, py] = [v.x + (sx - w / 2) / v.z, v.y + (sy - h / 2) / v.z];
      return { x: px - (sx - w / 2) / z, y: py - (sy - h / 2) / z, z };
    });
  }
  useEffect(() => {
    if (onCellPaint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const { camW, camH } = size.current;
      const step = 80 / (view.current?.z ?? 1);
      const pan = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
      if (pan) steer((v) => ({ ...v, x: v.x + pan[0], y: v.y + pan[1] }));
      else if (e.key === "+" || e.key === "=") zoomAt(1.25, camW / 2, camH / 2);
      else if (e.key === "-") zoomAt(0.8, camW / 2, camH / 2);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!sceneInView) return;
    let last = performance.now();
    let frame = 0;
    const tick = (snap: boolean) => {
      const now = performance.now();
      const dt = Math.max(1e-3, (now - last) / 1000);
      const k = snap ? 1 : 1 - Math.exp(-dt / EASE_S);
      const kGait = 1 - Math.exp(-dt / GAIT_EASE_S);
      const kCamera = snap ? 1 : 1 - Math.exp(-dt / CAMERA_EASE_S);
      last = now;
      const all = blobsRef.current;
      // Blobs out of view are only moved now and then (enough to know when
      // they walk in), so a crowded garden costs what's on screen. Partners
      // come along, since a couple walks together.
      // On the zoomed-out map, dots move less than a pixel a frame: a quarter of them each frame will do.
      frame++;
      const { blobs: seen, map } = inViewRef.current;
      const close = (b: SceneBlob) => b.seed === selectedRef.current || (!map && seen.has(b.seed));
      const every = map ? 4 : OFFSCREEN_EVERY;
      const list = all.filter((b, i) => close(b) || !shown.current.has(b.seed) || (frame + i) % every === 0);
      const picked = new Set(list.map((b) => b.seed));
      for (const b of all) if (b.partner && picked.has(b.partner) && !picked.has(b.seed)) list.push(b);
      const ps = targets(layoutRef.current, list, clockRef.current(), segmentsOfRef.current);
      list.forEach((b, i) => {
        const to = { ...ps[i]!, lift: liftRef.current(ps[i]!) };
        // Out of view (or a dot): straight there, no easing or gait to keep up.
        const prev = close(b) ? shown.current.get(b.seed) : undefined;
        const p = prev
          ? { x: prev.x + (to.x - prev.x) * k, y: prev.y + (to.y - prev.y) * k, lift: prev.lift + (to.lift - prev.lift) * k }
          : to;
        shown.current.set(b.seed, p);
        applyPosition(b.seed, p);
        if (snap || !prev) return arrived(b.seed, true);
        // Screen-space direction: +x on screen is ground (x - y).
        const [dx, dy] = [p.x - prev.x, p.y - prev.y];
        const dist = Math.hypot(dx, dy);
        const walking = dist / dt > WALK_SPEED;
        const g = gait.current.get(b.seed) ?? { phase: 0, walk: 0, hop: 0, lean: 0 };
        g.walk += ((walking ? 1 : 0) - g.walk) * kGait;
        // Only change gait while moving, so a stop ends the way it started.
        if (walking) g.hop += ((dist / dt > HOP_SPEED ? 1 : 0) - g.hop) * kGait;
        g.lean += ((walking ? ((dx - dy) / dist) * 5 : 0) - g.lean) * kGait;
        // Keep the gait going while fading out, so the last hop lands instead of freezing.
        if (g.walk > 0.01) g.phase += dt * Math.PI * HOP_HZ;
        gait.current.set(b.seed, g);
        applyGait(b.seed, g);
        arrived(b.seed, g.walk < 0.15);
      });
      applyCamera(kCamera);
    };
    // Reduced motion: no gliding, just re-place the blobs now and then.
    if (reducedMotion) {
      tick(true);
      const id = setInterval(() => tick(true), 10_000);
      return () => clearInterval(id);
    }
    let raf = requestAnimationFrame(function frame() {
      tick(false);
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
    // `selected` restarts the reduced-motion ticker so a click reframes at once.
  }, [sceneInView, reducedMotion, selected]);

  function place(seed: string, node: HTMLElement | null) {
    // Inline ref callbacks detach (null) and reattach on every render, so keep
    // `shown` across that — dropping it would snap a blob mid-glide.
    if (!node) {
      els.current.delete(seed);
      return;
    }
    els.current.set(seed, {
      el: node,
      body: node.querySelector<HTMLElement>("[data-body]"),
      shadow: node.querySelector<HTMLElement>("[data-shadow]"),
    });
    let p = shown.current.get(seed);
    if (!p) {
      const i = blobsRef.current.findIndex((b) => b.seed === seed);
      const g = targets(layoutRef.current, blobsRef.current, clockRef.current())[i] ?? { x: 0.5, y: 0.5 };
      p = { ...g, lift: liftRef.current(g) };
      shown.current.set(seed, p);
    }
    applyPosition(seed, p);
    const g = gait.current.get(seed);
    if (g) applyGait(seed, g);
  }

  function placeLabel(seed: string, node: HTMLElement | null) {
    if (!node) {
      labels.current.delete(seed);
      return;
    }
    labels.current.set(seed, node);
    const p = shown.current.get(seed);
    if (p) applyPosition(seed, p);
  }

  // Night dims the sprites themselves — per element, since a filter on a
  // shared wrapper would break the blobs' depth sorting against the decor.
  const spriteFilter = `brightness(${0.45 + 0.55 * light}) saturate(${0.55 + 0.45 * light})`;
  // Through a variable set on the scene, so the terrain needn't re-render as the light turns.
  const sprite = (at: { left: number; top: number }, w: number, z: number): CSSProperties => ({
    left: `${at.left}%`,
    top: `${at.top}%`,
    width: `${(w / island.w) * 100}%`,
    filter: "var(--sprite-filter)",
    zIndex: z,
  });


  // Meetings as of this render.
  const segmentsOf = new Map(blobs.map((b) => [b.seed, b.segments]));
  const moments = new Map(blobs.map((b) => [b.seed, momentAt(b.seed, b.segments, now, (seed) => segmentsOf.get(seed))]));

  const nest = layout.nest ?? NEST;
  const nestMid = (nest.min + nest.max) / 2;
  const nestW = (nest.max - nest.min) * tiles * 2 * HALF_W + 40;

  // The ground and everything standing on it only change with the layout:
  // thousands of sprites on a big map, so they're built once, not every tick,
  // and grouped by chunk so only the ones in view need mounting.
  const terrain = useMemo(() => {
    // Back to front, so each tile's sides are covered by the tiles in front of it.
    const tileCells = Array.from({ length: island.cols * island.rows }, (_, n) => ({
      i: n % island.cols,
      j: Math.floor(n / island.cols),
    })).sort((a, b) => a.i + a.j - (b.i + b.j));
    // Open sea (water all round) isn't drawn: the island floats in the sky
    // with just a ring of shallows, however big the map around it.
    const wet = (i: number, j: number) => {
      const g = cellAt(layout, i, j)?.ground;
      return !g || g === "water";
    };
    const openSea = (i: number, j: number) => {
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (!wet(i + di, j + dj)) return false;
      return true;
    };
    const items: TerrainSprite[] = [];
    for (const { i, j } of tileCells) {
      if (openSea(i, j)) continue;
      cellStack(layout, i, j).forEach((src, level) => {
        const at = island.at(i, j, level);
        // Shift so the image's top vertex (not its corner) lands on the grid point.
        const corner = { left: at.left - (TOP_X / island.w) * 100, top: at.top - (TOP_Y / island.h) * 100 };
        items.push({ key: `${i}-${j}-${level}`, i, j, src, at: corner, w: TILE_IMG_W, z: level === 0 ? 0 : cellZ(i + j), decor: false });
      });
    }
    layout.cells.forEach((cell, n) => {
      if (!cell.decor || !canHoldDecor(cell.ground) || cell.ramp) return;
      const [i, j] = [n % tiles, Math.floor(n / tiles)];
      const at = { x: (i + 0.5) / tiles, y: (j + 0.5) / tiles };
      const { src, w } = DECOR_SPRITES[cell.decor];
      items.push({ key: `decor-${n}`, i, j, src, at: island.at(at.x * tiles, at.y * tiles, cell.height ?? 0), w, z: depthZ(tiles, at), decor: true });
    });
    const chunks = new Map<string, { nodes: ReactNode[]; x0: number; y0: number; x1: number; y1: number }>();
    for (const item of items) {
      const key = `${Math.floor(item.i / CHUNK)},${Math.floor(item.j / CHUNK)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = { nodes: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
      chunk.nodes.push(
        <img
          key={item.key}
          src={item.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          // Decor is anchored at the sprite's base, a little above its bottom edge.
          className={`absolute max-w-none select-none ${item.decor ? "-translate-x-1/2 -translate-y-[92%]" : ""}`}
          style={sprite(item.at, item.w, item.z)}
        />,
      );
      const [x, y] = [(item.at.left / 100) * island.w, (item.at.top / 100) * island.h];
      chunk.x0 = Math.min(chunk.x0, x - CHUNK_PAD);
      chunk.x1 = Math.max(chunk.x1, x + CHUNK_PAD);
      chunk.y0 = Math.min(chunk.y0, y - CHUNK_PAD);
      chunk.y1 = Math.max(chunk.y1, y + CHUNK_PAD);
    }
    return { items, chunks };
    // `island` and `sprite` are pure functions of the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  const terrainRef = useRef(terrain);
  terrainRef.current = terrain;

  // The whole island, baked once into one picture for the zoomed-out map.
  const bakeRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = bakeRef.current;
    if (!culled || !canvas) return;
    let cancelled = false;
    const scale = Math.min(BAKE_PX / island.w, BAKE_PX / island.h);
    canvas.width = Math.round(island.w * scale);
    canvas.height = Math.round(island.h * scale);
    const images = new Map<string, Promise<HTMLImageElement>>();
    const load = (src: string) => {
      let img = images.get(src);
      if (!img) {
        const el = new Image();
        el.src = src;
        images.set(src, (img = el.decode().then(() => el)));
      }
      return img;
    };
    // Same order as the DOM: by z-index, ties in document order (sort is stable).
    const ordered = [...terrain.items].sort((a, b) => a.z - b.z);
    Promise.all(ordered.map((item) => load(item.src))).then((imgs) => {
      const ctx = canvas.getContext("2d");
      if (cancelled || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ordered.forEach((item, k) => {
        const img = imgs[k]!;
        const w = item.w * scale;
        const h = (w * img.naturalHeight) / img.naturalWidth;
        let [x, y] = [(item.at.left / 100) * canvas.width, (item.at.top / 100) * canvas.height];
        if (item.decor) [x, y] = [x - w / 2, y - 0.92 * h];
        ctx.drawImage(img, x, y, w, h);
      });
    }, () => {});
    return () => {
      cancelled = true;
    };
    // `island` is a pure function of the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, culled]);

  return (
    <div
      ref={sceneRef}
      // Fills its parent; `container-type: size` lets the island size itself in cq units.
      className="absolute inset-0 overflow-hidden [container-type:size]"
      style={{ background: skyGradient(light), transition: "background 2s", "--sprite-filter": spriteFilter } as CSSProperties}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      }}
      onClick={() => setSelected(null)}
      onPointerDown={startDrag}
      onWheel={(e) => {
        if (onCellPaint) return;
        const rect = e.currentTarget.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      }}
    >
      {STARS.map(([x, y]) => (
        <span
          key={`${x}-${y}`}
          aria-hidden="true"
          className="absolute size-[3px] rounded-full bg-white"
          style={{ left: `${x}%`, top: `${y}%`, opacity: (1 - light) * 0.85 }}
        />
      ))}

      <div ref={cloudsRef} className="absolute inset-0 origin-top-left">
      {CLOUDS.map((c) => (
        <img
          key={c.top}
          src={c.src}
          alt=""
          aria-hidden="true"
          className="absolute left-0 max-w-none"
          style={{
            top: `${c.top}%`,
            width: `${c.size}%`,
            opacity: 0.4 + 0.6 * light,
            filter: spriteFilter,
            ...(reducedMotion
              ? { transform: `translateX(${c.offset * 100}vw)` }
              : { animation: `cloud-drift ${c.duration}s linear ${-c.offset * c.duration}s infinite` }),
          }}
        />
      ))}

      </div>

      <div ref={cameraRef} className="absolute inset-0 origin-top-left">
      <div
        ref={islandRef}
        className="absolute top-[54%] left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: `calc(min(94cqw, ${84 * (island.w / island.h)}cqh) * ${res})`,
          aspectRatio: `${island.w} / ${island.h}`,
        }}
      >
        {culled ? (
          <canvas ref={bakeRef} aria-hidden="true" className="absolute inset-0 size-full" style={{ filter: "var(--sprite-filter)" }} />
        ) : null}
        {culled
          ? inView.chunks.map((key) => <Fragment key={key}>{terrain.chunks.get(key)?.nodes}</Fragment>)
          : [...terrain.chunks.values()].map((chunk) => chunk.nodes)}

        {/* The nest, flat on the ground over exactly the square blobs sleep in. */}
        <svg
          aria-hidden="true"
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={sprite(ground({ x: nestMid, y: nestMid }), nestW, 1)}
          viewBox="0 0 120 60"
        >
          <ellipse cx="60" cy="30" rx="56" ry="27" fill="#8a5a33" stroke="#000" strokeWidth="5" />
          <ellipse cx="60" cy="31" rx="36" ry="15" fill="#5e3b20" stroke="#000" strokeWidth="4" />
          <path d="M14 26 Q40 14 70 18 M50 46 Q80 44 104 30" stroke="#000" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>

        {onCellPaint ? <EditGrid layout={layout} island={island} onCellPaint={onCellPaint} /> : null}

        {blobs.filter((blob) => blob.seed === selected || (!inView.map && seesBlob(blob.seed))).map((blob) => (
          <SceneBlobView
            key={blob.seed}
            blob={blob}
            moment={moments.get(blob.seed) ?? null}
            size={blob.young ? Math.round(blobSize * 0.7) : blobSize}
            reducedMotion={reducedMotion}
            selected={blob.seed === selected}
            onSelect={(at) => pick(blob.seed, at)}
            placeRef={(node) => place(blob.seed, node)}
          />
        ))}

        {/* Names — and meeting effects — float above everything (blobs,
            trees, the edit grid) and don't hop, so they stay readable.
            Placed by the same loop. */}
        {/* The zoomed-out map: a dot per blob, yours bigger and gold. Click one to go to it. */}
        {inView.map
          ? blobs.map((blob) =>
              blob.seed === selected || !seesBlob(blob.seed) ? null : (
                <button
                  key={blob.seed}
                  ref={(node) => place(blob.seed, node)}
                  type="button"
                  aria-label={blob.label}
                  className="absolute top-0 left-0 size-0 will-change-transform"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(blob.seed);
                  }}
                >
                  <span
                    className={`absolute block -translate-x-1/2 -translate-y-1/2 rounded-full border border-black ${blob.seed === startAt ? "bg-amber-300" : "bg-white"}`}
                    style={{ width: `calc(${blob.seed === startAt ? 12 : 7}px / var(--camera-zoom, 1))`, height: `calc(${blob.seed === startAt ? 12 : 7}px / var(--camera-zoom, 1))` }}
                  />
                </button>
              ),
            )
          : null}

        {blobs.map((blob) => {
          // Names only close up (and yours, and the one followed, always).
          if (blob.seed !== selected && blob.seed !== startAt && (inView.map || !seesBlob(blob.seed))) return null;
          const moment = moments.get(blob.seed);
          const size = blob.young ? Math.round(blobSize * 0.7) : blobSize;
          return (
          <div
            key={blob.seed}
            ref={(node) => placeLabel(blob.seed, node)}
            className="pointer-events-none absolute top-0 left-0 will-change-transform"
            style={{ zIndex: 200_000 }}
            data-fx-key={moment?.key}
          >
            {moment ? (
              <InteractionFx moment={moment} size={size} bottom={blobSize * 0.84 + 14} />
            ) : blob.aura ? (
              <AuraFx aura={blob.aura} size={size} bottom={blobSize * 0.84 + 14} />
            ) : null}
            {/* Clicking a name selects its blob, even one hidden behind another.
                Mouse only: keyboard users reach the blob itself. */}
            <p
              className="pointer-events-auto absolute flex origin-bottom cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-black/35 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-black/60"
              style={{ bottom: blobSize * 0.84, transform: "translateX(-50%) scale(calc(1 / var(--camera-zoom, 1)))" }}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(blob.seed);
              }}
            >
              {blob.country ? (
                <span role="img" aria-label={countryName(blob.country)} title={countryName(blob.country)}>
                  {flagOf(blob.country)}
                </span>
              ) : null}
              {blob.label}
              <MoodIcon expression={blob.expression} />
              {blob.activity ? <ActivityIcon activity={blob.activity} /> : null}
            </p>
          </div>
          );
        })}
      </div>
      </div>

      {/* The selected blob's ID card: everything known about it, at a glance. */}
      {(() => {
        const blob = blobs.find((b) => b.seed === selected);
        if (!blob) return null;
        const mood = moodOf(blob.expression);
        return (
          <aside
            aria-label={`${blob.label}'s ID card`}
            className="absolute right-4 bottom-4 z-10 w-64 rounded-xl border bg-background/85 p-3 shadow-lg backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b pb-2">
              <h2 className="flex-1 truncate text-sm font-semibold">{blob.label}</h2>
              <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </button>
            </header>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Activity</dt>
                <dd className="flex items-center gap-1.5">
                  {blob.activity ? (
                    <>
                      <ActivityIcon activity={blob.activity} />
                      {blob.meetingWith ? `With ${blob.meetingWith}` : ACTIVITY_LABELS[blob.activity]}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Mood</dt>
                <dd className="flex items-center gap-1.5">
                  <MoodIcon expression={blob.expression} />
                  {mood?.label ?? "—"}
                </dd>
              </div>
              {blob.country ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Country</dt>
                  <dd className="truncate">
                    {flagOf(blob.country)} {countryName(blob.country)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Sex</dt>
                <dd>{SEX_LABELS[blob.sex]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Falls for</dt>
                <dd>{ATTRACTION_LABELS[blob.attraction]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Age</dt>
                <dd>{blob.young ? "Child" : "Grown-up"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="truncate">{blob.partner ? `With ${blob.partnerLabel ?? "someone"}` : "Single"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="truncate font-mono text-xs text-muted-foreground" title={blob.seed}>
                  {blob.seed.slice(0, 10)}
                </dd>
              </div>
            </dl>
            {onShowRelations ? (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => {
                  onShowRelations(blob.seed, blob.label);
                  // The relations panel takes over from the card, on the same side.
                  setSelected(null);
                }}
              >
                <HeartHandshake />
                See relations
              </Button>
            ) : null}
            {blob.onIdentityChange ? (
              <div className="mt-3 border-t pt-3">
                <IdentityFields value={{ sex: blob.sex, attraction: blob.attraction }} onChange={blob.onIdentityChange} />
                {blob.onCountryChange ? (
                  <div className="mt-3">
                    <CountryField value={blob.country ?? null} onChange={blob.onCountryChange} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        );
      })()}
    </div>
  );
}

/**
 * Edit mode: one clickable diamond per walkable cell, above everything else.
 * Press and drag to paint several cells in one stroke. The nest's cell is locked.
 */
function EditGrid({
  layout,
  island,
  onCellPaint,
}: {
  layout: IslandLayout;
  island: ReturnType<typeof islandGeometry>;
  onCellPaint: (cell: number) => void;
}) {
  const tiles = layout.size;
  const locked = nestCell(tiles);
  // Grid point, on cell (i, j)'s surface -> island user units (the SVG shares the island box's aspect).
  const pt = (i: number, j: number, u: number, v: number) => {
    const { left, top } = island.at(u, v, surfaceHeight(layout, i, j, u, v));
    return `${(left / 100) * island.w},${(top / 100) * island.h}`;
  };
  // Back to front, so a raised cell's diamond covers the ones behind it.
  const order = Array.from({ length: tiles * tiles }, (_, n) => n).sort(
    (a, b) => (a % tiles) + Math.floor(a / tiles) - ((b % tiles) + Math.floor(b / tiles)),
  );
  return (
    <svg
      className="absolute inset-0 size-full"
      style={{ zIndex: 100_000 }}
      viewBox={`0 0 ${island.w} ${island.h}`}
      // Touch pointers are implicitly captured by the cell they start on, which
      // would stop a drag from reaching the next cells.
      onPointerDown={(e) => (e.target as Element).releasePointerCapture?.(e.pointerId)}
    >
      {order.map((n) => {
        const [i, j] = [n % tiles, Math.floor(n / tiles)];
        const isLocked = n === locked;
        return (
          <polygon
            key={n}
            points={[pt(i, j, i, j), pt(i, j, i + 1, j), pt(i, j, i + 1, j + 1), pt(i, j, i, j + 1)].join(" ")}
            className={
              isLocked
                ? "cursor-not-allowed fill-transparent stroke-white/40"
                : "cursor-pointer fill-transparent stroke-white/60 hover:fill-white/30"
            }
            strokeWidth={4}
            strokeDasharray={isLocked ? "12 10" : undefined}
            onPointerDown={isLocked ? undefined : () => onCellPaint(n)}
            onPointerEnter={isLocked ? undefined : (e) => e.buttons === 1 && onCellPaint(n)}
          >
            <title>{isLocked ? "The nest — where your blob sleeps" : `Cell ${i + 1}, ${j + 1}`}</title>
          </polygon>
        );
      })}
    </svg>
  );
}

function SceneBlobView({
  blob,
  moment,
  size,
  reducedMotion,
  selected,
  onSelect,
  placeRef,
}: {
  blob: SceneBlob;
  moment: Moment | null;
  size: number;
  reducedMotion: boolean;
  selected: boolean;
  /** `at`: where it was clicked, to reach the blobs standing behind it. */
  onSelect: (at?: { x: number; y: number }) => void;
  placeRef: (node: HTMLElement | null) => void;
}) {
  // R4: each blob still only animates while it is on screen.
  const [inViewRef, inView] = useInView();
  return (
    // Zero-size anchor at the blob's feet; everything hangs off it.
    <div
      ref={(node) => {
        placeRef(node);
        inViewRef(node);
      }}
      className="absolute top-0 left-0 will-change-transform"
      data-fx-key={moment?.key}
    >
      <span
        aria-hidden="true"
        data-shadow
        className="absolute rounded-[50%] bg-black/25 blur-[2px]"
        style={{ width: size * 0.6, height: size * 0.18, transform: "translate(-50%, -50%)" }}
      />
      <div className="absolute -translate-x-1/2" style={{ bottom: -size * 0.2, width: size }}>
        {/* The walk cycle transforms this wrapper, never the blobatar itself. */}
        {/* The meeting moves it too (index.css), stacked under the walk cycle. */}
        <div
          data-body
          data-move={moment?.kind}
          style={moment ? ({ "--face": moment.face, "--turn": moment.turn, "--count": moment.count } as CSSProperties) : undefined}
          role="button"
          tabIndex={0}
          aria-label={`Follow ${blob.label}`}
          aria-pressed={selected}
          // Outline on hover or keyboard focus, and kept while the camera follows it.
          // Only the drawn silhouette takes the pointer: the blobatar's box has
          // transparent margins, which made the hover fire before reaching the blob.
          // The outline goes on the blobatar alone: its gender sign has its own stroke.
          className={`pointer-events-none origin-[50%_80%] cursor-pointer outline-none will-change-transform hover:[&>:first-child]:blob-outline focus-visible:[&>:first-child]:blob-outline [&_img]:pointer-events-auto [&_svg:not([data-gender])_*]:pointer-events-auto ${selected ? "[&>:first-child]:blob-outline" : ""}`}
          data-seed={blob.seed}
          onClick={(e) => {
            // Don't let the scene's own click (which zooms out) undo this.
            e.stopPropagation();
            onSelect({ x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onSelect();
          }}
        >
          <Blobatar
            name={blob.seed}
            size={size}
            animate={inView && !reducedMotion ? "always" : undefined}
            expression={blob.expression}
          />
          <BlobGenderSign seed={blob.seed} sex={blob.sex} size={size} animated={inView && !reducedMotion} />
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_ICONS = { sleep: Moon, wake: Sunrise, rest: Coffee, explore: Footprints, discover: Sparkles, meet: Users } as const;
export const ACTIVITY_LABELS: Record<Activity, string> = {
  sleep: "Sleeping",
  wake: "Waking up",
  rest: "Resting",
  explore: "Exploring",
  discover: "Found something",
  meet: "With someone",
};

export function ActivityIcon({ activity, className = "size-3" }: { activity: Activity; className?: string }) {
  const Icon = ACTIVITY_ICONS[activity];
  return <Icon className={className} aria-label={ACTIVITY_LABELS[activity]} role="img" />;
}

// Expressions are objects, so a mood is looked up by identity.
const MOODS = new Map<Expression, { label: string; emoji: string }>([
  [idle, { label: "Calm", emoji: "😌" }],
  [happy, { label: "Happy", emoji: "😊" }],
  [sleepy, { label: "Sleepy", emoji: "😴" }],
  [surprised, { label: "Surprised", emoji: "😮" }],
  [thinking, { label: "Thoughtful", emoji: "🤔" }],
  [love, { label: "In love", emoji: "🥰" }],
  [sad, { label: "Sad", emoji: "😢" }],
  [mad, { label: "Angry", emoji: "😠" }],
  [shy, { label: "Shy", emoji: "😳" }],
  [wink, { label: "Playful", emoji: "😉" }],
  [smug, { label: "Smug", emoji: "😏" }],
  [unsure, { label: "Unsure", emoji: "😕" }],
  [scared, { label: "Scared", emoji: "😨" }],
]);
export const moodOf = (expression: Expression) => MOODS.get(expression);

export function MoodIcon({ expression }: { expression: Expression }) {
  const mood = moodOf(expression);
  return mood ? (
    <span role="img" aria-label={mood.label} title={mood.label}>
      {mood.emoji}
    </span>
  ) : null;
}
