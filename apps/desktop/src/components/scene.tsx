import { daylight, legAt, NEST, type Activity, type GroundPoint, type Walkable } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { happy, idle, love, sleepy, surprised, thinking, type Expression } from "blobatar/expression";
import { Footprints, Moon, Sparkles, Coffee, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import cloudLarge from "@/assets/iso/cloud-large.png";
import cloudSmall from "@/assets/iso/cloud-small.png";
import DECOR_WIDTHS from "@/assets/iso/widths.json";
import {
  canHoldDecor,
  canStopAt,
  cellAt,
  DECOR_KINDS,
  EDGES,
  findPath,
  isSunken,
  nestCell,
  OPPOSITE_EDGE,
  rampDirection,
  surfaceHeight,
  type DecorKind,
  type Ground,
  type IslandLayout,
} from "@/lib/island";
import { useInView } from "@/lib/motion";

export interface SceneBlob {
  seed: string;
  label: string;
  expression: Expression;
  /** What it's doing right now, shown as an icon next to its name. */
  activity?: Activity;
  /** In an active union: walks with its partner instead of on its own. */
  paired?: boolean;
}

export interface SceneProps {
  blobs: SceneBlob[];
  /** Whose sleep window sets the sky — the viewer's own blob. */
  skySeed: string;
  reducedMotion: boolean;
  /** The walkable ground: which cells are water, what stands where. */
  layout: IslandLayout;
  /** Edit mode: when set, cells become clickable and report their index. */
  onCellPaint?: (cell: number) => void;
  /** Blob size as a fraction of one tile's width, so blobs keep their
   * proportions to the ground at any window size. */
  blobScale?: number;
}

// Half the distance two partners keep between them, per ground axis.
const PAIR_GAP = 0.04;
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

/**
 * Where each blob should stand at `t`. Pairs converge on the midpoint of
 * their two free positions, so a couple still wanders — just together.
 *
 * ponytail: /garden only says `paired`, not with whom, so paired blobs are
 * matched in seed order. Wrong when a partner is hidden or on another page;
 * return the partner's seed from /garden if that starts to show.
 */
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

function targets(layout: IslandLayout, blobs: SceneBlob[], t: number, walkable: Walkable): GroundPoint[] {
  const ps = blobs.map((b) => {
    const { from, to, e } = legAt(b.seed, t, walkable);
    return alongPath(findPath(layout, from, to), e);
  });
  const paired = blobs.map((b, i) => [b.seed, i] as const).filter(([, i]) => blobs[i]!.paired).sort();
  const clamp = (v: number) => Math.min(1 - PAIR_GAP, Math.max(PAIR_GAP, v));
  for (let j = 0; j + 1 < paired.length; j += 2) {
    const [a, b] = [paired[j]![1], paired[j + 1]![1]];
    const mid = { x: clamp((ps[a]!.x + ps[b]!.x) / 2), y: clamp((ps[a]!.y + ps[b]!.y) / 2) };
    // Side by side along the screen's horizontal, so neither hides the other.
    ps[a] = { x: mid.x - PAIR_GAP, y: mid.y + PAIR_GAP };
    ps[b] = { x: mid.x + PAIR_GAP, y: mid.y - PAIR_GAP };
  }
  return ps;
}

/*
 * Depth order. Everything on cell diagonal d = i + j sits in its own band
 * [10 + 1000d, 10 + 1000(d+1)): the blocks raised above the base level at the
 * bottom of the band, then what stands on the cell, back to front. So a hill
 * hides blobs behind it and never the ones in front or on top. The base-level
 * tiles stay below every band, painted back to front by DOM order.
 */
const cellZ = (d: number) => 10 + d * 1000;
function depthZ(tiles: number, p: GroundPoint) {
  const [u, v] = [p.x * tiles, p.y * tiles];
  const [i, j] = [Math.min(tiles - 1, Math.floor(u)), Math.min(tiles - 1, Math.floor(v))];
  return cellZ(i + j) + 1 + Math.round((u - i + (v - j)) * 490);
}

export function Scene({ blobs, skySeed, reducedMotion, layout, onCellPaint, blobScale = 0.6 }: SceneProps) {
  const tiles = layout.size;
  const [sceneRef, sceneInView] = useInView();
  const [light, setLight] = useState(() => daylight(skySeed, Date.now()));
  useEffect(() => {
    setLight(daylight(skySeed, Date.now()));
    const id = setInterval(() => setLight(daylight(skySeed, Date.now())), 60_000);
    return () => clearInterval(id);
  }, [skySeed]);

  const lift = Math.max(0, ...layout.cells.map((c) => (c.height ?? 0) + (c.ramp ? 1 : 0)));
  const island = islandGeometry(tiles, lift);
  const ground = (p: GroundPoint) => island.at(p.x * tiles, p.y * tiles);
  const islandGeomRef = useRef(island);
  islandGeomRef.current = island;

  // The loop reads the latest props through refs and writes position straight
  // to the DOM, so a garden refresh doesn't restart it and frames don't re-render React.
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
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
  // Blobs only stop where they can stand: not in water, not inside a tree.
  const walkableRef = useRef<Walkable>(() => true);
  walkableRef.current = (p) => canStopAt(layout, p);
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
  // The island is sized by CSS from the window; blobs follow its tile width.
  const [islandPx, setIslandPx] = useState(0);
  useLayoutEffect(() => {
    const box = islandRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setIslandPx(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const blobSize = Math.max(32, Math.round(((islandPx * 2 * HALF_W) / island.w) * blobScale));
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
  // ponytail: blobs don't path through ramps, they hop straight up cliffs;
  // positionAt would need the terrain to route them.
  const shown = useRef(new Map<string, GroundPoint & { lift: number }>());

  /*
   * Moving blobs go through `transform`, not `left`/`top`: a transform is
   * composited at sub-pixel precision, while `left`/`top` re-run layout each
   * frame and WebKit (Tauri's webview on macOS) snaps them to whole pixels —
   * which is what made the walk stutter.
   */
  /** A blob's feet, in px from the island box's top-left corner. */
  function blobPx(box: HTMLElement, p: GroundPoint & { lift: number }) {
    const { left, top } = groundRef.current(p);
    return {
      x: (left / 100) * box.clientWidth,
      y: (top / 100) * box.clientHeight - (p.lift * box.clientHeight) / islandGeomRef.current.h,
    };
  }

  function applyPosition(seed: string, p: GroundPoint & { lift: number }) {
    const box = islandRef.current;
    if (!box) return;
    const { x, y } = blobPx(box, p);
    const at = `translate3d(${x}px, ${y}px, 0)`;
    const blob = els.current.get(seed);
    if (blob) {
      blob.el.style.transform = at;
      blob.el.style.zIndex = String(depthZ(tiles, p));
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

  /*
   * The camera scales the whole world (island, blobs, labels — not the sky)
   * around a focus point: the selected blob, or the middle of the scene. It
   * eases like everything else, so following a walking blob stays smooth.
   */
  function applyCamera(k: number) {
    const cam = cameraRef.current;
    const box = islandRef.current;
    if (!cam || !box) return;
    const [w, h] = [cam.clientWidth, cam.clientHeight];
    let target = { x: w / 2, y: h / 2, z: 1 };
    const seed = selectedRef.current;
    const p = seed ? shown.current.get(seed) : undefined;
    if (p && blobsRef.current.some((b) => b.seed === seed)) {
      const feet = blobPx(box, p);
      // The island is centred with a -50%/-50% translate that offsetLeft/Top ignore.
      const x = box.offsetLeft - box.clientWidth / 2 + feet.x;
      const y = box.offsetTop - box.clientHeight / 2 + feet.y - blobSizeRef.current * 0.4;
      target = { x, y, z: FOCUS_ZOOM };
    }
    const c = camera.current ?? target;
    const next = { x: c.x + (target.x - c.x) * k, y: c.y + (target.y - c.y) * k, z: c.z + (target.z - c.z) * k };
    camera.current = next;
    cam.style.transform = `translate(${w / 2 - next.x * next.z}px, ${h / 2 - next.y * next.z}px) scale(${next.z})`;
    const clouds = cloudsRef.current;
    if (clouds) {
      const z = 1 + (next.z - 1) * CLOUD_PARALLAX;
      clouds.style.transform = `translate(${w / 2 - next.x * z}px, ${h / 2 - next.y * z}px) scale(${z})`;
    }
    // Labels divide by this to keep their on-screen size while zoomed.
    cam.style.setProperty("--camera-zoom", String(next.z));
  }

  useEffect(() => {
    if (!sceneInView) return;
    let last = performance.now();
    const tick = (snap: boolean) => {
      const now = performance.now();
      const dt = Math.max(1e-3, (now - last) / 1000);
      const k = snap ? 1 : 1 - Math.exp(-dt / EASE_S);
      const kGait = 1 - Math.exp(-dt / GAIT_EASE_S);
      const kCamera = snap ? 1 : 1 - Math.exp(-dt / CAMERA_EASE_S);
      last = now;
      const list = blobsRef.current;
      const ps = targets(layoutRef.current, list, Date.now(), walkableRef.current);
      list.forEach((b, i) => {
        const to = { ...ps[i]!, lift: liftRef.current(ps[i]!) };
        const prev = shown.current.get(b.seed);
        const p = prev
          ? { x: prev.x + (to.x - prev.x) * k, y: prev.y + (to.y - prev.y) * k, lift: prev.lift + (to.lift - prev.lift) * k }
          : to;
        shown.current.set(b.seed, p);
        applyPosition(b.seed, p);
        if (snap || !prev) return;
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
      const g = targets(layoutRef.current, blobsRef.current, Date.now(), walkableRef.current)[i] ?? { x: 0.5, y: 0.5 };
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
  const sprite = (at: { left: number; top: number }, w: number, z: number): CSSProperties => ({
    left: `${at.left}%`,
    top: `${at.top}%`,
    width: `${(w / island.w) * 100}%`,
    filter: spriteFilter,
    zIndex: z,
  });

  // Back to front, so each tile's sides are covered by the tiles in front of it.
  const tileCells = Array.from({ length: island.cols * island.rows }, (_, n) => ({
    i: n % island.cols,
    j: Math.floor(n / island.cols),
  })).sort((a, b) => a.i + a.j - (b.i + b.j));

  const nestMid = (NEST.min + NEST.max) / 2;
  const nestW = (NEST.max - NEST.min) * tiles * 2 * HALF_W + 40;

  return (
    <div
      ref={sceneRef}
      // Fills its parent; `container-type: size` lets the island size itself in cq units.
      className="absolute inset-0 overflow-hidden [container-type:size]"
      style={{ background: skyGradient(light), transition: "background 2s" }}
      onClick={() => setSelected(null)}
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
          width: `min(94cqw, ${84 * (island.w / island.h)}cqh)`,
          aspectRatio: `${island.w} / ${island.h}`,
        }}
      >
        {tileCells.flatMap(({ i, j }) =>
          cellStack(layout, i, j).map((src, level) => {
            const at = island.at(i, j, level);
            // Shift so the image's top vertex (not its corner) lands on the grid point.
            const corner = { left: at.left - (TOP_X / island.w) * 100, top: at.top - (TOP_Y / island.h) * 100 };
            return (
              <img
                key={`${i}-${j}-${level}`}
                src={src}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute max-w-none select-none"
                style={sprite(corner, TILE_IMG_W, level === 0 ? 0 : cellZ(i + j))}
              />
            );
          }),
        )}

        {/* The nest, flat on the ground over exactly the square positionAt sleeps in. */}
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

        {layout.cells.map((cell, n) => {
          if (!cell.decor || !canHoldDecor(cell.ground) || cell.ramp) return null;
          const at = { x: ((n % tiles) + 0.5) / tiles, y: (Math.floor(n / tiles) + 0.5) / tiles };
          const { src, w } = DECOR_SPRITES[cell.decor];
          const base = island.at(at.x * tiles, at.y * tiles, cell.height ?? 0);
          return (
            <img
              key={n}
              src={src}
              alt=""
              aria-hidden="true"
              draggable={false}
              // Anchored at the sprite's base, a little above its bottom edge.
              className="absolute max-w-none -translate-x-1/2 -translate-y-[92%] select-none"
              style={sprite(base, w, depthZ(tiles, at))}
            />
          );
        })}

        {onCellPaint ? <EditGrid layout={layout} island={island} onCellPaint={onCellPaint} /> : null}

        {blobs.map((blob) => (
          <SceneBlobView
            key={blob.seed}
            blob={blob}
            size={blobSize}
            reducedMotion={reducedMotion}
            selected={blob.seed === selected}
            onSelect={() => setSelected(blob.seed)}
            placeRef={(node) => place(blob.seed, node)}
          />
        ))}

        {/* Names float above everything — blobs, trees, the edit grid — and
            don't hop, so they stay readable. Placed by the same loop. */}
        {blobs.map((blob) => (
          <div
            key={blob.seed}
            ref={(node) => placeLabel(blob.seed, node)}
            className="pointer-events-none absolute top-0 left-0 will-change-transform"
            style={{ zIndex: 200_000 }}
          >
            <p
              className="absolute flex origin-bottom items-center gap-1 whitespace-nowrap rounded-full bg-black/35 px-2 py-0.5 text-xs font-medium text-white"
              style={{ bottom: blobSize * 0.72, transform: "translateX(-50%) scale(calc(1 / var(--camera-zoom, 1)))" }}
            >
              {blob.label}
              <MoodIcon expression={blob.expression} />
              {blob.activity ? <ActivityIcon activity={blob.activity} /> : null}
            </p>
          </div>
        ))}
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
                      {ACTIVITY_LABELS[blob.activity]}
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
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>{blob.paired ? "Paired up" : "Single"}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">ID</dt>
                <dd className="truncate font-mono text-xs text-muted-foreground" title={blob.seed}>
                  {blob.seed.slice(0, 10)}
                </dd>
              </div>
            </dl>
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
  size,
  reducedMotion,
  selected,
  onSelect,
  placeRef,
}: {
  blob: SceneBlob;
  size: number;
  reducedMotion: boolean;
  selected: boolean;
  onSelect: () => void;
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
    >
      <span
        aria-hidden="true"
        data-shadow
        className="absolute rounded-[50%] bg-black/25 blur-[2px]"
        style={{ width: size * 0.6, height: size * 0.18, transform: "translate(-50%, -50%)" }}
      />
      <div className="absolute -translate-x-1/2" style={{ bottom: -size * 0.2, width: size }}>
        {/* The walk cycle transforms this wrapper, never the blobatar itself. */}
        <div
          data-body
          role="button"
          tabIndex={0}
          aria-label={`Follow ${blob.label}`}
          aria-pressed={selected}
          // Outline on hover or keyboard focus, and kept while the camera follows it.
          // Only the drawn silhouette takes the pointer: the blobatar's box has
          // transparent margins, which made the hover fire before reaching the blob.
          className={`pointer-events-none origin-[50%_80%] cursor-pointer outline-none will-change-transform hover:blob-outline focus-visible:blob-outline [&_img]:pointer-events-auto [&_svg_*]:pointer-events-auto ${selected ? "blob-outline" : ""}`}
          onClick={(e) => {
            // Don't let the scene's own click (which zooms out) undo this.
            e.stopPropagation();
            onSelect();
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
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_ICONS = { sleep: Moon, rest: Coffee, explore: Footprints, discover: Sparkles } as const;
export const ACTIVITY_LABELS: Record<Activity, string> = {
  sleep: "Sleeping",
  rest: "Resting",
  explore: "Exploring",
  discover: "Found something",
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
