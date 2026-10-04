import { alongPath, flagOf, legIn, legProgress, NEST, segmentAt, segmentNow, walkMs, type Activity, type Attraction, type Gait, type GroundPoint, type Personality, type Route, type Segment, type Sex, type Spell } from "@blob-land/sim";
import * as EXPRESSIONS from "blobatar/expression";
import { happy, idle, love, mad, sad, scared, shy, sleepy, smug, surprised, thinking, unsure, wink, type Expression } from "blobatar/expression";
import { Coffee, Footprints, HeartHandshake, Moon, Sparkles, Sunrise, Users, X } from "lucide-react";
import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { AuraFx, InteractionFx, momentAt, type Aura, type Moment } from "@/components/interaction-fx";
import { CHUNK, depthZ, MAP_CELLS, NAME_CELLS, HALF_W, islandGeometry, LEVEL, prepareBlob, WATER_DROP, World, type IslandGeometry } from "@/components/world";
import { canWalkStraight, cellAt, findPath, homeNest, isSunken, nestCell, snapToGround, surfaceHeight, type IslandLayout } from "@/lib/island";
import { GLOOM } from "@/components/sky";
import { seasonNow, skyAt, weatherNow } from "@/lib/dev";
import { useInView } from "@/lib/motion";
import { characterName, countryName, useT } from "@/i18n";
import type { Messages } from "@/i18n/en";

export { BRIDGE_THUMB, DECOR_SPRITES, GROUND_THUMBS, RAMP_THUMB } from "@/components/world";

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
  /** Its character, for the ID card. */
  personality?: Personality;
  /** How it walks: its player's pick, or its character's way. An easy stroll if unset. */
  gait?: Gait;
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
  /** Where its player is from (ISO code), if they share it: a flag by its name. */
  country?: string | null;
}

/** A stored expression name as blobatar's expression object. */
export const expressionNamed = (name: string): Expression =>
  (EXPRESSIONS as unknown as Record<string, Expression | undefined>)[name] ?? idle;

/** What a blob is doing and wearing at `t`, read off its timeline. */
export function blobStateAt(segments: readonly Segment[], t: number): { activity: Activity; expression: Expression; since: number } {
  const seg = segmentNow(segments, t);
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
  /** Hides the ID card of the blob followed (a panel is taking its place); the blob stays followed. */
  cardHidden?: boolean;
  /** On a map too big to show whole, the blob the camera starts on. */
  startAt?: string;
  /** The island's sky, spell by spell: clear when unset. */
  weather?: Spell[];
}

// Half the distance two partners keep between them, per ground axis.
const PAIR_GAP = 0.04;
// Past 8 tiles a side, ground units cover more tiles: slow walks (and pull
// couples closer) by as much, so blobs keep their pace and spacing per tile.
const walkZoom = (tiles: number) => Math.max(1, tiles / 8);
// How many tiles fit across the screen at the camera's starting zoom, on a
// big map; smaller maps start fully in view.
const TILES_IN_VIEW = 14;
// Out of view, a blob's position is refreshed once every this many frames.
const OFFSCREEN_EVERY = 20;
// Seconds for the displayed position to close ~63% of a jump in the computed
// one (a new pairing, a timeline refetched). Walking itself is drawn as is,
// along its path: easing it would cut corners, through cliffs and water.
const EASE_S = 0.6;
// Faster than this (ground units per garden ms, several times any walk), the
// computed position jumped rather than walked.
const JUMP_SPEED = 0.3 / 1000;
// How fast the gait fades in/out.
const GAIT_EASE_S = 0.25;
// Below this speed (units/s, on a small island's scale) a blob counts as standing still: it's
// where the position easing's long tail ends, not a real step.
const WALK_SPEED = 0.006;
/**
 * Each gait's walk cycle: steps per second, the pace above which it hops
 * rather than waddles (0: always, Infinity: never), how high it hops, how
 * much it flattens landing, and its side-to-side waddle and lean in degrees.
 */
const GAITS: Record<Gait, { hz: number; hopAt: number; lift: number; squash: number; waddle: number; lean: number }> = {
  // 99% of a stroll stays under 0.036, so only long, quick crossings (and catch-ups like a new pairing) hop.
  stroll: { hz: 2.4, hopAt: 0.045, lift: 1, squash: 0.09, waddle: 4, lean: 5 },
  bouncy: { hz: 3, hopAt: 0, lift: 0.75, squash: 0.12, waddle: 2, lean: 5 },
  // Slow and swaying, chin up.
  proud: { hz: 1.7, hopAt: Infinity, lift: 0, squash: 0, waddle: 8, lean: 1 },
  // Quick little steps, leaning in.
  shy: { hz: 3.6, hopAt: Infinity, lift: 0, squash: 0, waddle: 2, lean: 9 },
  // Low, heavy hops that flatten it on every landing.
  stomp: { hz: 1.9, hopAt: 0, lift: 0.3, squash: 0.2, waddle: 3, lean: 4 },
};
// Camera: how far it zooms onto a selected blob, and how softly it moves.
const FOCUS_ZOOM = 2;
// On a big map, following a blob shows about this many tiles across.
const FOCUS_TILES = 6;
const CAMERA_EASE_S = 0.45;
// Letting go of a blob zooms out to this share of the followed zoom.
const UNFOLLOW_ZOOM = 0.5;
// Zooming in starts once what's left to pan is under 1 / this of the screen's diagonal.
const ZOOM_AFTER_PAN = 3;
// The outline around a blob under the pointer, focused or followed, in screen px.
const OUTLINE_PX = 2;
/*
 * The garden draws at the screen's rate up to about 120 fps: a 240 Hz screen
 * gets every other frame. Blobs stroll; past 120, a frame costs as much and
 * shows nothing more. Screens in between (144 Hz) keep their own rate.
 */
const FRAME_MS = 1000 / 120;

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const mix = (a: string, b: string, p: number) =>
  `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i]! - v) * p)).join(" ")})`;

const SKY = { night: ["#0b1026", "#27305a"], dusk: ["#3b3f78", "#f2a07b"], day: ["#4fb8f0", "#d8f1ff"], grey: ["#7f8ea3", "#c7d0db"] };

/** Daylight `d` in [0, 1], greyed by `gloom` (a cloudy or rainy sky's) by day. */
function skyGradient(d: number, gloom: number): string {
  const [from, to, p] = d < 0.5 ? [SKY.night, SKY.dusk, d * 2] : [SKY.dusk, SKY.day, (d - 0.5) * 2];
  const grey = d < 0.5 ? 0 : (d - 0.5) * 2 * gloom * 0.8;
  const stop = (k: number) => {
    const [r, g, b] = hex(from[k]!).map((v, i) => v + (hex(to[k]!)[i]! - v) * p);
    return mix(`#${[r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, "0")).join("")}`, SKY.grey[k]!, grey);
  };
  return `linear-gradient(to bottom, ${stop(0)}, ${stop(1)})`;
}

// Fixed decor — ambience only, no behaviour.
const STARS = [
  [8, 12], [17, 30], [26, 8], [38, 22], [47, 5], [55, 34], [63, 14], [72, 27], [81, 9], [90, 20], [95, 38], [33, 40],
];

// Free to wander off with a partner: not asleep, not busy with someone else.
const FREE = new Set<Activity>(["explore", "rest", "discover"]);

/** Where a blob should stand, and whether it's still on its way to a meeting (its show waits till it's there). */
type Target = GroundPoint & { comingToMeet?: boolean };

/**
 * A blob's walk, worked out once and played back frame after frame: the
 * waypoints, when it sets off and how long it takes, until when it holds, and
 * when everyone it's meeting has arrived. Only how far along changes in between.
 */
interface Plan {
  seg: Segment;
  ended: boolean;
  path: GroundPoint[];
  /** How far along the path each of its points is. */
  reach: Float64Array;
  start: number;
  ms: number;
  until: number;
  arrive: number;
  /** Where it stands, handed back by `targets`: the same object every frame, updated. */
  at: Target;
}
// For the layout and timelines last asked about: a new one of either starts over.
let plans = { layout: null as IslandLayout | null, segmentsOf: null as Map<string, Segment[]> | null, of: new Map<string, Plan>() };

/**
 * Where each blob should stand at `t`, played back from its timeline and
 * routed around cliffs and water. A couple who are both free walks together,
 * converging on the midpoint of their two own positions. Asked again about
 * the same timelines, it updates and hands back the same points: read them first.
 */
export function targets(layout: IslandLayout, blobs: SceneBlob[], t: number, segmentsOf = new Map(blobs.map((b) => [b.seed, b.segments]))): Target[] {
  const zoom = walkZoom(layout.size);
  const gap = PAIR_GAP / zoom;
  const route: Route = (a, b) => findPath(layout, a, b);
  if (plans.layout !== layout || plans.segmentsOf !== segmentsOf) plans = { layout, segmentsOf, of: new Map() };
  const planFor = (b: SceneBlob): Plan | null => {
    // Each to its own nest at night.
    const home = homeNest(layout, b.seed, b.partner);
    const snap = (p: GroundPoint, from?: GroundPoint) => {
      const to = snapToGround(layout, p, home);
      if (!from) return to;
      // An explore's stop is one a straight walk reaches: a blob out for a stroll
      // doesn't go the long way round a lake or along a cliff.
      return canWalkStraight(layout, from, to) ? to : from;
    };
    const endOf = (seg: Segment) => endPoint(seg, segmentsOf, snap, zoom);
    const at = segmentAt(b.segments, t, snap);
    if (!at) return null;
    const stand: Target = { x: 0, y: 0 };
    if (t >= at.seg.end) return { seg: at.seg, ended: true, path: [endOf(at.seg)], reach: new Float64Array(1), start: 0, ms: 0, until: Infinity, arrive: -Infinity, at: stand };
    const before = b.segments[b.segments.indexOf(at.seg) - 1];
    const start = before ? endOf(before) : at.from;
    const spot = at.seg.activity === "meet" ? meetingSpot(at.seg, segmentsOf, snap, zoom) : null;
    const leg = legIn(at.seg, start, t, spot ? () => spot : snap, zoom, route);
    const arrive = spot ? arrival(layout, at.seg, b.segments, segmentsOf, zoom) : -Infinity;
    const path = findPath(layout, leg.from, leg.to);
    const reach = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) reach[k] = reach[k - 1]! + Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y);
    return { seg: at.seg, ended: false, path, reach, start: leg.start, ms: leg.ms, until: leg.until, arrive, at: stand };
  };
  const ps = blobs.map((b): Target => {
    const seg = segmentNow(b.segments, t);
    let plan = plans.of.get(b.seed);
    if (!plan || plan.seg !== seg || t >= plan.until || t >= plan.seg.end !== plan.ended) {
      const made = planFor(b);
      if (!made) return { x: 0.5, y: 0.5 };
      plans.of.set(b.seed, (plan = made));
    }
    along(plan, legProgress(plan, t));
    plan.at.comingToMeet = t < plan.arrive;
    return plan.at;
  });
  const index = new Map(blobs.map((b, i) => [b.seed, i]));
  const clamp = (v: number) => Math.min(1 - gap, Math.max(gap, v));
  blobs.forEach((b, i) => {
    const j = b.partner ? index.get(b.partner) : undefined;
    if (j === undefined || b.seed > blobs[j]!.seed) return;
    const [sa, sb] = [segmentNow(b.segments, t), segmentNow(blobs[j]!.segments, t)];
    if (!sa || !sb || !FREE.has(sa.activity) || !FREE.has(sb.activity)) return;
    const mid = { x: clamp((ps[i]!.x + ps[j]!.x) / 2), y: clamp((ps[i]!.y + ps[j]!.y) / 2) };
    // Side by side along the screen's horizontal, so neither hides the other.
    ps[i] = { x: mid.x - gap, y: mid.y + gap };
    ps[j] = { x: mid.x + gap, y: mid.y - gap };
  });
  return ps;
}

/** Puts a plan's `at` at the point `e` of the way along its path: alongPath, by the lengths worked out once. */
function along({ path, reach, at }: Plan, e: number) {
  const total = reach[reach.length - 1]!;
  if (path.length < 2 || total === 0) {
    const p = alongPath(path, e);
    [at.x, at.y] = [p.x, p.y];
    return;
  }
  const left = e * total;
  // The first point at least that far along.
  let [lo, hi] = [1, path.length - 1];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reach[mid]! >= left) hi = mid;
    else lo = mid + 1;
  }
  const [a, b] = [path[lo - 1]!, path[lo]!];
  const len = reach[lo]! - reach[lo - 1]!;
  const f = len === 0 ? 0 : Math.min(1, (left - reach[lo - 1]!) / len);
  at.x = a.x + (b.x - a.x) * f;
  at.y = a.y + (b.y - a.y) * f;
}

/** Where a segment leaves its blob: for a meeting, its place in the gathering
 * as drawn, not the sim's own point for it (see meetingSpot). */
function endPoint(seg: Segment, segmentsOf: Map<string, Segment[]>, snap: (p: GroundPoint) => GroundPoint, zoom: number): GroundPoint {
  return seg.activity === "meet" ? meetingSpot(seg, segmentsOf, snap, zoom) : snap({ x: seg.x, y: seg.y });
}

/**
 * When everyone at the gathering `seg` is part of has arrived: no one talks
 * to someone still finishing another meeting, or still on the way. A member
 * whose timeline isn't here (hidden) never arrives.
 */
function arrival(layout: IslandLayout, seg: Segment, mine: Segment[], segmentsOf: Map<string, Segment[]>, zoom: number): number {
  const snap = (p: GroundPoint) => snapToGround(layout, p);
  const members = gathering(seg, segmentsOf);
  if (members.length < (seg.with?.length ?? 0) + 1) return Infinity;
  return Math.max(
    ...members.map((x, i) => {
      const own = i === 0 ? mine : segmentsOf.get(seg.with![i - 1]!)!;
      const before = own[own.indexOf(x) - 1];
      const from = before ? endPoint(before, segmentsOf, snap, zoom) : snap({ x: x.x, y: x.y });
      return x.start + walkMs(x, from, meetingSpot(x, segmentsOf, snap, zoom), zoom, (a, b) => findPath(layout, a, b));
    }),
  );
}

/** Everyone's segment of the gathering `seg` is part of (the ones the timelines hold), its own first. */
function gathering(seg: Segment, segmentsOf: Map<string, Segment[]>): Segment[] {
  return [seg, ...(seg.with ?? []).flatMap((s) => segmentsOf.get(s)?.find((x) => x.activity === "meet" && x.end === seg.end) ?? [])];
}

/**
 * Where a blob stands in a meeting: its place in the sim's ring, around the
 * middle of the whole gathering — everyone's, even those not on their way
 * yet, so the middle never moves while it lasts — moved as one if that
 * middle isn't somewhere blobs can stand (a tree, water). The sim's ring is
 * in garden units: shrunk by `zoom`, like a couple's gap, so a gathering
 * stands as close on a big island as on a small one.
 */
function meetingSpot(seg: Segment, segmentsOf: Map<string, Segment[]>, snap: (p: GroundPoint) => GroundPoint, zoom: number): GroundPoint {
  const spots = gathering(seg, segmentsOf);
  const mid = { x: spots.reduce((a, x) => a + x.x, 0) / spots.length, y: spots.reduce((a, x) => a + x.y, 0) / spots.length };
  const moved = snap(mid);
  return { x: moved.x + (seg.x - mid.x) / zoom, y: moved.y + (seg.y - mid.y) / zoom };
}

export function Scene({ blobs, reducedMotion, layout, onCellPaint, blobScale = 0.6, clock = Date.now, onShowRelations, cardHidden, startAt, weather }: SceneProps) {
  const t = useT();
  const tiles = layout.size;
  // Fitting the whole map is zoom 1; how far in the camera starts, and follows a blob.
  const baseZoom = Math.max(1, tiles / TILES_IN_VIEW);
  const focusZoom = Math.max(FOCUS_ZOOM, tiles / FOCUS_TILES);
  const [sceneRef, sceneInView] = useInView();
  const sceneEl = useRef<HTMLDivElement | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  // Read on each render: the screen re-renders on its own tick.
  const now = clock();
  const light = skyAt(now);
  const gloom = GLOOM[weatherNow(weather ?? [], now)];
  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  const island = useMemo(() => islandGeometry(tiles, Math.max(0, ...layout.cells.map((c) => (c.height ?? 0) + (c.ramp ? 1 : 0)))), [layout, tiles]);
  const islandRef = useRef<IslandGeometry>(island);
  islandRef.current = island;

  // The loop reads the latest props through refs and draws straight to the
  // world, so a garden refresh doesn't restart it and frames don't re-render React.
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  const bySeed = useMemo(() => new Map(blobs.map((b) => [b.seed, b])), [blobs]);
  const bySeedRef = useRef(bySeed);
  bySeedRef.current = bySeed;
  // Everyone's timeline by seed, for meetings, whoever is being moved this frame.
  const segmentsOfRef = useRef(new Map<string, Segment[]>());
  // Kept while every timeline is the same one: the screen re-renders now and then with the same timelines,
  // and a new map would make every walk be worked out again (see targets).
  const lastSegmentsOf = segmentsOfRef.current;
  if (lastSegmentsOf.size !== blobs.length || blobs.some((b) => lastSegmentsOf.get(b.seed) !== b.segments))
    segmentsOfRef.current = new Map(blobs.map((b) => [b.seed, b.segments]));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  // How high a blob's feet are, in pack px: up hills and ramps, and down into
  // water, where it wades.
  const liftAt = (p: GroundPoint) => {
    const [u, v] = [p.x * tiles, p.y * tiles];
    const [i, j] = [Math.min(tiles - 1, Math.floor(u)), Math.min(tiles - 1, Math.floor(v))];
    const cell = cellAt(layout, i, j);
    return surfaceHeight(layout, i, j, u, v) * LEVEL - (cell && isSunken(cell.ground) && !cell.bridge ? WATER_DROP : 0);
  };
  const liftRef = useRef(liftAt);
  liftRef.current = liftAt;
  const overlayRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // The WebGL world, once it's up (a frame or two after mounting).
  const [world, setWorld] = useState<World | null>(null);
  const worldRef = useRef<World | null>(null);
  worldRef.current = world;
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    let cancelled = false;
    let made: World | null = null;
    World.create(host).then(
      (w) => {
        if (cancelled) return w.destroy();
        made = w;
        setWorld(w);
      },
      (error: unknown) => console.error("The garden couldn't start its renderer", error),
    );
    return () => {
      cancelled = true;
      made?.destroy();
    };
  }, []);

  // Click a blob to zoom onto it and follow it; click anywhere else (or Escape) to zoom back out.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Under the pointer, and focused from the keyboard: both outlined, like the one followed.
  const hovered = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const camera = useRef<{ x: number; y: number; z: number } | null>(null);
  // Whether the camera was following a blob last frame.
  const following = useRef(false);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  /*
   * The island's box, fitting the screen at zoom 1, in "fit" px: the
   * camera's coordinates. `k` is fit px per pack px. Read once per resize.
   */
  const size = useRef({ w: 0, h: 0, left: 0, top: 0, camW: 0, camH: 0 });
  const [box, setBox] = useState({ left: 0, top: 0, w: 0, h: 0 });
  const k = () => size.current.w / islandRef.current.w;
  function measure() {
    const el = sceneEl.current;
    if (!el) return;
    const [camW, camH] = [el.clientWidth, el.clientHeight];
    const g = islandRef.current;
    const w = Math.min(0.94 * camW, 0.84 * camH * (g.w / g.h));
    const h = (w * g.h) / g.w;
    const [left, top] = [camW / 2 - w / 2, 0.54 * camH - h / 2];
    size.current = { w, h, left, top, camW, camH };
    worldRef.current?.resize(camW, camH);
    setBox((b) => (b.w === w && b.h === h && b.left === left && b.top === top ? b : { left, top, w, h }));
    dirty.current = true;
  }
  useLayoutEffect(() => {
    const el = sceneEl.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      measure();
      if (camera.current) applyCamera(0);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The island's shape changed (it grew, or a block was stacked), or the world came up: fit it again.
  useLayoutEffect(() => {
    measure();
    if (camera.current) applyCamera(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island, world]);
  // In fit px.
  const blobSize = Math.max(32 / baseZoom, Math.round(((box.w * 2 * HALF_W) / island.w) * blobScale));
  const blobSizeRef = useRef(blobSize);
  blobSizeRef.current = blobSize;
  const sizeOf = (blob: SceneBlob) => (blob.young ? Math.round(blobSize * 0.7) : blobSize);
  // Names (and meeting effects), by seed.
  const labels = useRef(new Map<string, HTMLElement>());
  // The camera's zoom, as last written to labels.
  const zoomVar = useRef(1);
  // `phase` drives the gait; `walk` in [0, 1] is how much the blob is walking,
  // eased so a stop settles instead of freezing mid-air; `hop` in [0, 1] is how
  // much of that walk is hopping rather than waddling; `lean` tilts it.
  type Stride = { phase: number; walk: number; hop: number; lean: number; style: (typeof GAITS)[Gait] };
  const gait = useRef(new Map<string, Stride>());
  // `lift`: how high the feet are (see liftAt), eased like x/y so stepping
  // into water or up a cliff is a quick slide rather than a jump.
  const shown = useRef(new Map<string, GroundPoint & { lift: number }>());
  // Where each blob's timeline put it last frame, and when (garden time).
  const aimed = useRef(new Map<string, GroundPoint>());
  const aimedAt = useRef(0);
  // Something to draw since the last frame, when nothing moves on its own.
  const dirty = useRef(true);

  /** A blob's feet, in pack px: read at once, the same object is reused on the next call. */
  const foot = useRef({ x: 0, y: 0 }).current;
  function feet(p: GroundPoint & { lift: number }) {
    const n = layoutRef.current.size;
    const at = islandRef.current.at(p.x * n, p.y * n);
    foot.x = at.x;
    foot.y = at.y - p.lift;
    return foot;
  }

  function applyPosition(seed: string, p: GroundPoint & { lift: number }) {
    const world = worldRef.current;
    if (!world) return;
    const f = feet(p);
    const followed = seed === selectedRef.current;
    // The one followed too: behind a hill, it's hidden like any other (its name stays on top).
    world.blobs.get(seed)?.place(f.x, f.y, depthZ(layoutRef.current.size, p.x, p.y) + 0.5);
    const { map, blobs: seen } = inViewRef.current;
    if (map && !followed && seen.has(seed)) world.dot(seed, seed === startAt, f.x, f.y);
    const label = labels.current.get(seed);
    if (label) placeLabel(seed, label);
  }

  /** A name (and its meeting effects) over its blob's head, on screen. */
  function placeLabel(seed: string, el: HTMLElement) {
    const p = shown.current.get(seed);
    const c = camera.current;
    if (!p || !c) return;
    const f = feet(p);
    const { left, top, camW, camH } = size.current;
    const s = k();
    const [x, y] = [camW / 2 + (left + f.x * s - c.x) * c.z, camH / 2 + (top + f.y * s - c.y) * c.z];
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  /** The edit grid, over the island's box, moved with the camera. */
  function placeGrid() {
    const [grid, c] = [gridRef.current, camera.current];
    const { camW: w, camH: h } = size.current;
    if (grid && c) grid.style.transform = `translate(${w / 2 - c.x * c.z}px, ${h / 2 - c.y * c.z}px) scale(${c.z})`;
  }

  /** Hop (or waddle), squash and lean the body; the world shrinks the shadow while airborne. */
  function applyGait(seed: string, g: Stride) {
    const hop = g.walk * g.hop;
    const lift = Math.abs(Math.sin(g.phase)) * hop * g.style.lift; // 0 on the ground, 1 at the top of a hop
    const squash = g.style.squash * hop * (1 - Math.abs(Math.sin(g.phase))) ** 2; // flattens on landing
    const waddle = Math.sin(g.phase) * g.style.waddle * g.walk * (1 - g.hop); // side to side, feet on the ground
    worldRef.current?.blobs.get(seed)?.walk(lift, g.lean + waddle, squash);
  }

  /**
   * Blobs overlap. Clicking where several stand selects the frontmost, and
   * clicking again there goes to the next one behind it, round and round.
   */
  function pick(x: number, y: number) {
    const world = worldRef.current;
    if (!world || onCellPaint) return setSelected(null);
    const stack = world.blobsAt(x, y);
    if (stack.length) {
      const i = stack.indexOf(selectedRef.current ?? "");
      return setSelected(i >= 0 && stack.length > 1 ? stack[(i + 1) % stack.length]! : stack[0]!);
    }
    // The zoomed-out map: click a dot to go to it.
    setSelected(world.dotAt(x, y));
  }

  /*
   * Flags whether a blob has stopped walking, which starts its meeting
   * effects: its body's moves (drawn by the world) and the ones over its head
   * (index.css). On arrival at a new meeting, those effects' clocks are set
   * to the page's time origin, so everyone at the meeting is in step:
   * speakers take turns instead of talking over each other.
   */
  function arrived(seed: string, still: boolean, now: number) {
    worldRef.current?.blobs.get(seed)?.still(still, now);
    const el = labels.current.get(seed);
    if (!el) return;
    if (el.dataset.still !== (still ? "1" : "0")) el.dataset.still = still ? "1" : "0";
    const key = el.dataset.fxKey ?? "";
    if (!still || !key || el.dataset.synced === key) return;
    el.dataset.synced = key;
    toSync.current.push(el);
  }
  // Labels whose meeting clocks are to be set, all at once after the frame's
  // writes: getAnimations forces a style recalc, one per label if interleaved.
  const toSync = useRef<HTMLElement[]>([]);
  function syncMeetings() {
    // Hello and the moment's fade-in play from arrival, not in step with the rest.
    const once = (name: string | undefined) => name === "fx-hello" || name === "fx-act";
    for (const el of toSync.current) {
      for (const a of el.getAnimations({ subtree: true })) {
        const name = (a as CSSAnimation).animationName;
        if (name?.startsWith("fx-") && !once(name)) a.startTime = 0;
      }
    }
    toSync.current = [];
  }

  /*
   * The camera scales the whole world (island, blobs, labels — not the sky)
   * around a focus point: the selected blob, or the middle of the scene. It
   * eases like everything else, so following a walking blob stays smooth.
   */
  function applyCamera(kc: number) {
    const { camW: w, camH: h, left, top } = size.current;
    if (!w) return;
    const s = k();
    // A blob's head, in fit px.
    const headOf = (p: GroundPoint & { lift: number }) => {
      const f = feet(p);
      return { x: left + f.x * s, y: top + f.y * s - blobSizeRef.current * 0.4 };
    };
    const seed = selectedRef.current;
    const p = seed ? shown.current.get(seed) : undefined;
    let target: { x: number; y: number; z: number };
    if (p && bySeedRef.current.has(seed!)) {
      target = { ...headOf(p), z: focusZoom };
      following.current = true;
    } else {
      // Let go of a blob: back off a little from where the camera is, not all the way to where it came from.
      if (following.current && camera.current) view.current = { ...camera.current, z: camera.current.z * UNFOLLOW_ZOOM };
      following.current = false;
      if (!view.current) {
        const start = startAt ? shown.current.get(startAt) : undefined;
        view.current = start ? { ...headOf(start), z: baseZoom } : { x: w / 2, y: h / 2, z: baseZoom };
      }
      target = view.current = clampView(view.current);
    }
    const c = camera.current ?? target;
    // Easing never quite arrives: settle once what's left is a twentieth of a
    // pixel on screen, so a camera at rest stops redrawing the world.
    const close = Math.hypot(target.x - c.x, target.y - c.y) * c.z < 0.05 && Math.abs(target.z - c.z) / c.z < 1e-4;
    // Zooming in waits for the pan: from far off, the camera first travels to the
    // target, then closes in on it, instead of zooming where it stands.
    const toPan = (Math.hypot(target.x - c.x, target.y - c.y) * c.z) / Math.hypot(w, h);
    const kz = kc < 1 && target.z > c.z ? kc * Math.max(0, 1 - toPan * ZOOM_AFTER_PAN) : kc;
    const next = close ? target : { x: c.x + (target.x - c.x) * kc, y: c.y + (target.y - c.y) * kc, z: c.z + (target.z - c.z) * kz };
    camera.current = next;
    // Always: the world may have come up after the camera settled.
    worldRef.current?.setCamera(next.z * s, w / 2 + (left - next.x) * next.z, h / 2 + (top - next.y) * next.z);
    // Redrawn (and labels, culling) once it has moved a quarter of a pixel on
    // screen: the tail of an ease is otherwise a redraw a frame for nothing.
    const d = placed.current;
    if (d && Math.hypot(next.x - d.x, next.y - d.y) * next.z < 0.25 && Math.abs(next.z - d.z) / next.z < 1e-3) return;
    placed.current = next;
    dirty.current = true;
    placeGrid();
    // Labels and meeting effects size themselves by this: the effects zoom
    // with the world, the names keep their size.
    if (next.z !== zoomVar.current) {
      zoomVar.current = next.z;
      for (const el of labels.current.values()) el.style.setProperty("--camera-zoom", String(next.z));
    }
    cull();
    for (const [seed, el] of labels.current) placeLabel(seed, el);
  }

  /*
   * The camera the visitor steers when no blob is followed: drag to pan,
   * wheel (or +/-) to zoom around the pointer, arrows to pan. Kept over the
   * island, and between fitting it whole and the follow zoom.
   */
  const view = useRef<{ x: number; y: number; z: number } | null>(null);
  // Where the camera was when the world, labels and culling last followed it.
  const placed = useRef<{ x: number; y: number; z: number } | null>(null);
  function clampView(v: { x: number; y: number; z: number }) {
    const { w, h, left, top } = size.current;
    if (!w) return v;
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    return { x: clamp(v.x, left, left + w), y: clamp(v.y, top, top + h), z: clamp(v.z, 1, focusZoom) };
  }
  // The island grew (or shrank) a step under the camera: zoom by as much, so
  // the tiles keep their size on screen and the world grows around the view.
  const lastTiles = useRef(tiles);
  useLayoutEffect(() => {
    const ratio = tiles / lastTiles.current;
    lastTiles.current = tiles;
    if (ratio === 1) return;
    for (const v of [view, camera]) if (v.current) v.current = { ...v.current, z: v.current.z * ratio };
  }, [tiles]);
  /*
   * What's in view, updated by the frame loop only when it changes: which
   * ground chunks to draw, whether it's the zoomed-out map, and which blobs.
   * Empty until the first frame has placed the camera.
   */
  // On a big map only what the camera sees is drawn: the ground in chunks, and the blobs near the screen.
  const culled = tiles * tiles > MAP_CELLS;
  const [inView, setInView] = useState({ chunks: [] as string[], map: false, far: false, blobs: new Set<string>() });
  const inViewRef = useRef(inView);
  const seesBlob = (seed: string) => inView.blobs.has(seed);
  /** The screen, in the island's pack px. */
  function viewRect() {
    const c = camera.current;
    const { w, left, top, camW, camH } = size.current;
    if (!c || !w) return null;
    const s = islandRef.current.w / w;
    const [hw, hh] = [camW / 2 / c.z, camH / 2 / c.z];
    return { x0: (c.x - hw - left) * s, x1: (c.x + hw - left) * s, y0: (c.y - hh - top) * s, y1: (c.y + hh - top) * s };
  }
  function cull() {
    const world = worldRef.current;
    const r = viewRect();
    if (!r || !world) return;
    const prev = inViewRef.current;
    let { chunks, map, far } = prev;
    const keys: string[] = [];
    for (const [key, b] of world.chunkBounds) if (!culled || (b.x1 > r.x0 && b.x0 < r.x1 && b.y1 > r.y0 && b.y0 < r.y1)) keys.push(key);
    map = culled && keys.length * CHUNK * CHUNK > MAP_CELLS;
    far = culled && keys.length * CHUNK * CHUNK > NAME_CELLS;
    const next = map ? [] : keys;
    if (next.join() !== chunks.join()) chunks = next;
    // Blobs a little past the edges too, so they're drawn before they walk in.
    const pad = (blobSizeRef.current * 2) / (k() || 1);
    const blobs = new Set<string>();
    for (const b of blobsRef.current) {
      const p = shown.current.get(b.seed);
      if (!p) continue;
      const { x, y } = feet(p);
      if (x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad * 1.5) blobs.add(b.seed);
    }
    world.wantMap(far || map);
    if (chunks !== prev.chunks) world.showChunks(chunks);
    if (map !== prev.map) world.setMap(map);
    const sameBlobs = prev.blobs.size === blobs.size && [...blobs].every((seed) => prev.blobs.has(seed));
    if (chunks === prev.chunks && map === prev.map && far === prev.far && sameBlobs) return;
    inViewRef.current = { chunks, map, far, blobs: sameBlobs ? prev.blobs : blobs };
    // The names that come with it render between frames: a few dozen at once would hold one up.
    const latest = inViewRef.current;
    startTransition(() => setInView(latest));
    syncViews();
  }

  // Meetings as of this render, for the blobs drawn: in view, followed, or the player's own.
  const drawn = blobs.filter((b) => inView.blobs.has(b.seed) || b.seed === selected || b.seed === startAt);
  const moments = new Map(drawn.map((b) => [b.seed, momentAt(b.seed, b.segments, now, (seed) => segmentsOfRef.current.get(seed))]));
  const momentsRef = useRef(moments);
  momentsRef.current = moments;

  /** The blob `seed` as it should look now: its size, sign, expression and meeting. */
  function refresh(seed: string, at: number) {
    const world = worldRef.current;
    const blob = bySeedRef.current.get(seed);
    const view = world?.blobs.get(seed);
    if (!world || !blob || !view) return;
    const fit = blob.young ? Math.round(blobSizeRef.current * 0.7) : blobSizeRef.current;
    view.update(fit / (k() || 1), blob.sex, blob.expression, momentsRef.current.get(seed) ?? null, reducedRef.current, at);
  }

  /**
   * Draws the blobs in view as themselves (and the one followed, always) and,
   * on the zoomed-out map, the others as dots; drops the rest.
   */
  function syncViews() {
    const world = worldRef.current;
    if (!world) return;
    const { blobs: seen, map } = inViewRef.current;
    const followed = selectedRef.current;
    // Not one that's left (a visitor gone home): it may still be counted in view until the next cull.
    const want = new Set<string>(map ? [] : [...seen].filter((seed) => bySeedRef.current.has(seed)));
    if (followed && bySeedRef.current.has(followed)) want.add(followed);
    for (const seed of [...world.blobs.keys()]) if (!want.has(seed)) world.dropBlob(seed);
    const at = performance.now();
    for (const seed of want) {
      if (world.blobs.has(seed)) continue;
      world.blob(seed);
      refresh(seed, at);
      const g = gait.current.get(seed);
      if (g) applyGait(seed, g);
    }
    const dots = new Set(map ? [...seen].filter((seed) => seed !== followed && bySeedRef.current.has(seed)) : []);
    world.keepDots(dots);
    for (const seed of new Set([...want, ...dots])) {
      const p = shown.current.get(seed);
      if (p) applyPosition(seed, p);
    }
    dirty.current = true;
  }

  // Every render: new props for the blobs drawn (a new expression, a meeting), and who's drawn.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    syncViews();
    const at = performance.now();
    for (const seed of world.blobs.keys()) refresh(seed, at);
    dirty.current = true;
  });

  // Everyone's shapes, a few at a time between frames, before they're first seen.
  useEffect(() => {
    const queue = [...blobs];
    let timer = 0;
    const next = () => {
      for (const blob of queue.splice(0, 8)) prepareBlob(blob.seed, blob.sex, blob.expression);
      if (queue.length) timer = window.setTimeout(next, 30);
    };
    timer = window.setTimeout(next, 500);
    return () => clearTimeout(timer);
  }, [blobs]);

  // The ground, whenever the layout changes: shown once its sprites are loaded.
  useEffect(() => {
    if (!world) return;
    const nests = layout.nests ?? [{ x: (NEST.min + NEST.max) / 2, y: (NEST.min + NEST.max) / 2, r: (NEST.max - NEST.min) / 2 }];
    let cancelled = false;
    void world.setTerrain(layout, island, nests).then(() => {
      if (cancelled) return;
      // Everything in view is mounted again, with the new chunks.
      inViewRef.current = { ...inViewRef.current, chunks: [] };
      cull();
      dirty.current = true;
    });
    return () => {
      cancelled = true;
    };
    // `island` is a pure function of the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, layout]);

  // Where steering starts from: the camera itself while it follows a blob.
  const steerFrom = () => (selectedRef.current ? camera.current : (view.current ?? camera.current));
  /** Takes the camera back from a followed blob, from where it is now. */
  function steer(change: (v: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) {
    const from = steerFrom();
    if (!from) return;
    following.current = false;
    if (selectedRef.current) {
      // At once, not at the next render: the frame loop would otherwise follow the blob again meanwhile.
      selectedRef.current = null;
      setSelected(null);
    }
    view.current = clampView(change({ ...from }));
    if (reducedMotion) applyCamera(1);
  }
  // Set by a drag, so the click that ends it doesn't also select or deselect.
  const dragged = useRef(false);
  const dragging = useRef(false);
  function startDrag(e: ReactPointerEvent) {
    if (onCellPaint || e.button !== 0) return;
    const [x0, y0] = [e.clientX, e.clientY];
    let from: { x: number; y: number; z: number } | null = null;
    const onMove = (m: PointerEvent) => {
      const [dx, dy] = [m.clientX - x0, m.clientY - y0];
      if (!from && Math.hypot(dx, dy) < 5) return;
      dragging.current = true;
      from ??= steerFrom();
      const f = from;
      if (f) steer(() => ({ x: f.x - dx / f.z, y: f.y - dy / f.z, z: f.z }));
    };
    const onUp = () => {
      dragged.current = from !== null;
      dragging.current = false;
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
    // Straight to it: easing x, y and the zoom apart would curve the point under the pointer off its place.
    applyCamera(1);
  }
  // Wheel (or a trackpad's scroll and pinch) zooms. Listened to natively:
  // React's wheel listener is passive, so it can't keep the webview from
  // scrolling or zooming the page itself.
  useEffect(() => {
    const el = sceneEl.current;
    if (onCellPaint || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // A pinch comes as a ctrl-wheel, in much smaller steps.
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
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

  /** Whatever is under the pointer gets the outline and the hover lift. */
  function hover(at: number) {
    const world = worldRef.current;
    const el = sceneEl.current;
    if (!world || !el) return;
    const p = pointer.current;
    const seed = p && !dragging.current && !onCellPaint ? (world.blobsAt(p.x, p.y)[0] ?? null) : null;
    const dot = p && !seed && !dragging.current ? world.dotAt(p.x, p.y) : null;
    el.style.cursor = onCellPaint ? "" : dragging.current ? "grabbing" : seed || dot ? "pointer" : "grab";
    if (seed === hovered.current) return;
    world.blobs.get(hovered.current ?? "")?.hover(false, at);
    world.blobs.get(seed ?? "")?.hover(true, at);
    hovered.current = seed;
    dirty.current = true;
  }

  useEffect(() => {
    if (!sceneInView || !world) return;
    let last = performance.now();
    let frame = 0;
    // Reduced motion: no gliding, just re-place the blobs now and then.
    let nextMove = 0;
    let lastLight = -1;
    let lastGloom = -1;
    // The bench reads how long each frame's work takes here (see src/bench).
    const profile = (window as { sceneProfile?: { tickMs: number; renderMs: number; ticks: number; renders: number } }).sceneProfile;
    const tick = () => {
      const now = performance.now();
      if (profile) profile.ticks++;
      const reduced = reducedRef.current;
      const snap = reduced;
      const dt = Math.max(1e-3, (now - last) / 1000);
      const k = snap ? 1 : 1 - Math.exp(-dt / EASE_S);
      const kGait = 1 - Math.exp(-dt / GAIT_EASE_S);
      const kCamera = snap ? 1 : 1 - Math.exp(-dt / CAMERA_EASE_S);
      last = now;
      frame++;
      const { blobs: seen, map } = inViewRef.current;
      // The zoomed-out map, camera still: dots crawl under a pixel a frame and
      // clouds drift slower still, so a quarter of the frames will do.
      const resting = map && !dirty.current && frame % 4 !== 0;
      if ((!reduced && !resting) || (reduced && now >= nextMove)) {
        nextMove = now + 10_000;
        const all = blobsRef.current;
        // Blobs out of view are only moved now and then (enough to know when
        // they walk in), so a crowded garden costs what's on screen. Partners
        // come along, since a couple walks together.
        // On the zoomed-out map, all of them, on the frames it draws.
        const close = (b: SceneBlob) => b.seed === selectedRef.current || (!map && seen.has(b.seed));
        const every = map ? 1 : OFFSCREEN_EVERY;
        const list = all.filter((b, i) => close(b) || !shown.current.has(b.seed) || (frame + i) % every === 0);
        const picked = new Set(list.map((b) => b.seed));
        for (const b of all) if (b.partner && picked.has(b.partner) && !picked.has(b.seed)) list.push(b);
        const t = clockRef.current();
        const jump = Math.max(0, t - aimedAt.current) * JUMP_SPEED;
        aimedAt.current = t;
        const ps = targets(layoutRef.current, list, t, segmentsOfRef.current);
        // Someone new (a visitor, a newborn): placed now, so whether it's in view can be told.
        const arriving = list.some((b) => !shown.current.has(b.seed));
        // Positions are kept in the same objects frame after frame, updated in place: a few hundred new ones a frame add up.
        list.forEach((b, i) => {
          const to = ps[i]!;
          const lift = liftRef.current(to);
          let last = aimed.current.get(b.seed);
          // Walking, the blob moves as its timeline does and only what's left
          // of an earlier jump fades; a jump fades from where it's drawn.
          const [fromX, fromY] = last && Math.hypot(to.x - last.x, to.y - last.y) <= jump ? [last.x, last.y] : [to.x, to.y];
          if (!last) aimed.current.set(b.seed, (last = { x: 0, y: 0 }));
          last.x = to.x;
          last.y = to.y;
          let p = shown.current.get(b.seed);
          // Out of view (or a dot): straight there, no easing or gait to keep up.
          const eased = p !== undefined && close(b);
          if (!p) shown.current.set(b.seed, (p = { x: to.x, y: to.y, lift }));
          const [px, py] = [p.x, p.y];
          if (eased) {
            p.x = to.x + (px - fromX) * (1 - k);
            p.y = to.y + (py - fromY) * (1 - k);
            p.lift += (lift - p.lift) * k;
          } else [p.x, p.y, p.lift] = [to.x, to.y, lift];
          applyPosition(b.seed, p);
          if (snap || !eased) return arrived(b.seed, true, now);
          // Screen-space direction: +x on screen is ground (x - y).
          const [dx, dy] = [p.x - px, p.y - py];
          const dist = Math.hypot(dx, dy);
          // Per tile, like the walks themselves (see walkZoom): a stroll across a big island is as slow as one across a small one.
          const pace = (dist / dt) * walkZoom(layoutRef.current.size);
          const walking = pace > WALK_SPEED;
          const style = GAITS[b.gait ?? "stroll"];
          const g = gait.current.get(b.seed) ?? { phase: 0, walk: 0, hop: 0, lean: 0, style };
          g.style = style;
          g.walk += ((walking ? 1 : 0) - g.walk) * kGait;
          // Only change gait while moving, so a stop ends the way it started.
          if (walking) g.hop += ((pace > style.hopAt ? 1 : 0) - g.hop) * kGait;
          g.lean += ((walking ? ((dx - dy) / dist) * style.lean : 0) - g.lean) * kGait;
          // Keep the gait going while fading out, so the last hop lands instead of freezing.
          if (g.walk > 0.01) g.phase += dt * Math.PI * style.hz;
          gait.current.set(b.seed, g);
          applyGait(b.seed, g);
          arrived(b.seed, g.walk < 0.15 && !ps[i]!.comingToMeet, now);
        });
        if (arriving) cull();
        dirty.current = true;
      }
      applyCamera(kCamera);
      syncMeetings();
      hover(now);
      const at = clockRef.current();
      const light = skyAt(at);
      const weather = weatherNow(weatherRef.current ?? [], at);
      const gloom = GLOOM[weather];
      if (Math.abs(light - lastLight) > 0.002 || gloom !== lastGloom) {
        [lastLight, lastGloom] = [light, gloom];
        world.setLight(light, gloom);
        dirty.current = true;
      }
      world.sky.set(weather, seasonNow(at));
      // Blobs breathe, clouds drift and rain falls: close up, every frame is a new one.
      const animated = !reduced && !resting && (world.blobs.size > 0 || map || world.sky.active(light));
      if (!dirty.current && !animated) return;
      world.setClouds(size.current.camW, size.current.camH, camera.current?.x ?? 0, camera.current?.y ?? 0, camera.current?.z ?? 1, now, reduced);
      world.sky.frame(size.current.camW, size.current.camH, now, light, reduced || map);
      for (const view of world.blobs.values()) {
        const outlined = view.seed === selectedRef.current || view.seed === hovered.current || view.seed === focused.current;
        view.frame(now, reduced, outlined ? OUTLINE_PX : 0, world.scale);
      }
      const drawn = performance.now();
      world.render(now);
      dirty.current = false;
      if (profile) {
        profile.renderMs += performance.now() - drawn;
        profile.renders++;
        profile.tickMs += drawn - now;
      }
    };
    // The screen's frame interval, smoothed (hitches left out). On a screen at
    // twice FRAME_MS's rate or more, only every so many frames are drawn.
    let interval = FRAME_MS;
    let lastFrame = 0;
    let skipped = 0;
    let raf = requestAnimationFrame(function loop(at) {
      raf = requestAnimationFrame(loop);
      const gap = at - lastFrame;
      lastFrame = at;
      if (gap > 0 && gap < 20) interval += (gap - interval) * 0.05;
      if (++skipped < Math.max(1, Math.floor((FRAME_MS + 0.5) / interval))) return;
      skipped = 0;
      tick();
    });
    return () => cancelAnimationFrame(raf);
    // The loop runs this render's functions, which read the island's size
    // (whether it's big enough for a map, how far to zoom): a new size, a new loop.
  }, [sceneInView, world, tiles]);
  // A click reframes at once, and draws.
  useEffect(() => {
    dirty.current = true;
  }, [selected]);

  // Stable, so labels needn't re-render with the scene: they only read refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placeLabelRef = useCallback((seed: string, node: HTMLElement | null) => placeRef(seed, node), []);
  const focusBlob = useCallback((seed: string | null) => {
    focused.current = seed;
    dirty.current = true;
  }, []);

  function placeRef(seed: string, node: HTMLElement | null) {
    if (!node) {
      labels.current.delete(seed);
      return;
    }
    node.style.setProperty("--camera-zoom", String(zoomVar.current));
    labels.current.set(seed, node);
    placeLabel(seed, node);
  }

  return (
    <div
      ref={(node) => {
        sceneEl.current = node;
        sceneRef(node);
      }}
      className="absolute inset-0 select-none overflow-hidden"
      data-view={inView.map ? "map" : inView.far ? "far" : "near"}
      style={{ background: skyGradient(light, gloom), transition: "background 2s" }}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pick(e.clientX - r.left, e.clientY - r.top);
      }}
      onPointerDown={startDrag}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onPointerLeave={() => {
        pointer.current = null;
      }}
    >
      {STARS.map(([x, y]) => (
        <span
          key={`${x}-${y}`}
          aria-hidden="true"
          className="absolute size-[3px] rounded-full bg-white"
          style={{ left: `${x}%`, top: `${y}%`, opacity: (1 - light) * 0.85 * (1 - gloom) }}
        />
      ))}

      {/* The world: clouds, ground, decor, blobs, nests and the map's dots, in WebGL. */}
      <div ref={canvasHost} aria-hidden="true" className="absolute inset-0" />

      {/* Edit mode: the grid, over the world, moved with the camera. */}
      {onCellPaint ? (
        <div
          ref={(node) => {
            gridRef.current = node;
            placeGrid();
          }}
          className="absolute inset-0 origin-top-left"
        >
          <EditGrid layout={layout} island={island} box={box} onCellPaint={onCellPaint} />
        </div>
      ) : null}

      {/* Names — and meeting effects — float above everything and don't hop,
          so they stay readable. Placed on screen by the same loop. */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-0">
        {blobs.map((blob) =>
          // Names only close up (and yours, and the one followed, always).
          blob.seed !== selected && blob.seed !== startAt && (inView.far || !seesBlob(blob.seed)) ? null : (
            <Label
              key={blob.seed}
              blob={blob}
              size={sizeOf(blob)}
              blobSize={blobSize}
              moment={moments.get(blob.seed)}
              selected={blob.seed === selected}
              place={placeLabelRef}
              select={setSelected}
              focus={focusBlob}
            />
          ),
        )}
      </div>

      {/* The selected blob's ID card: everything known about it, at a glance. */}
      {(() => {
        const blob = bySeed.get(selected ?? "");
        if (!blob || cardHidden) return null;
        const mood = moodOf(blob.expression);
        return (
          <aside
            aria-label={t.card.of(blob.label)}
            className="absolute right-4 bottom-4 z-10 w-64 toon p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="-mx-3 -mt-3 flex items-center gap-2 rounded-t-[1rem] border-b-[3px] border-ink bg-grass px-3 py-2">
              <h2 className="flex-1 truncate text-base font-bold">{blob.label}</h2>
              <button type="button" aria-label={t.common.close} className="text-ink/70 hover:text-ink" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </button>
            </header>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.activity}</dt>
                <dd className="flex items-center gap-1.5">
                  {blob.activity ? (
                    <>
                      <ActivityIcon activity={blob.activity} />
                      {blob.meetingWith ? t.card.with(blob.meetingWith) : t.activity[blob.activity]}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.mood}</dt>
                <dd className="flex items-center gap-1.5">
                  <MoodIcon expression={blob.expression} />
                  {mood ? t.mood[mood.key] : "—"}
                </dd>
              </div>
              {blob.country ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t.card.country}</dt>
                  <dd className="truncate">
                    {flagOf(blob.country)} {countryName(blob.country)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.sex}</dt>
                <dd>{t.sex[blob.sex]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.fallsFor}</dt>
                <dd>{t.attraction[blob.attraction]}</dd>
              </div>
              {blob.personality ? (
                <div className="flex items-start justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">{t.card.character}</dt>
                  <dd className="text-right">
                    {characterName(blob.personality)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.age}</dt>
                <dd>{blob.young ? t.card.child : t.card.grownUp}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.status}</dt>
                <dd className="truncate">{blob.partner ? t.card.with(blob.partnerLabel ?? t.card.someone) : t.card.single}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t.card.id}</dt>
                <dd className="truncate font-mono text-xs text-muted-foreground" title={blob.seed}>
                  {blob.seed.slice(0, 10)}
                </dd>
              </div>
            </dl>
            {onShowRelations ? (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => {
                  onShowRelations(blob.seed, blob.label);
                }}
              >
                <HeartHandshake />
                {t.card.relations}
              </Button>
            ) : null}
          </aside>
        );
      })()}
    </div>
  );
}

interface LabelProps {
  blob: SceneBlob;
  /** Its size and a grown-up's, in fit px. */
  size: number;
  blobSize: number;
  moment: Moment | null | undefined;
  selected: boolean;
  place: (seed: string, node: HTMLElement | null) => void;
  select: (seed: string) => void;
  /** Keyboard focus on a blob (null: off it), for its outline. */
  focus: (seed: string | null) => void;
}

// What a label shows of its blob: the screen hands over new blobs every few seconds, mostly unchanged.
const sameShown = (a: SceneBlob, b: SceneBlob) =>
  a === b || (a.seed === b.seed && a.label === b.label && a.expression === b.expression && a.activity === b.activity && a.country === b.country && a.aura === b.aura);

const sameMoment = (a: Moment | null | undefined, b: Moment | null | undefined) =>
  a === b || (!!a && !!b && a.key === b.key && a.leaving === b.leaving && a.kind === b.kind && a.outcome === b.outcome && a.turn === b.turn && a.count === b.count && a.face === b.face);

/**
 * A blob's name (and its meeting effects), placed over its head by the
 * scene's loop. Re-rendered only when what it shows changes: the scene
 * renders again whenever who's in view does, with a few dozen of these.
 */
const Label = memo(
  function Label({ blob, size, blobSize, moment, selected, place, select, focus }: LabelProps) {
    const t = useT();
    return (
      <div ref={(node) => place(blob.seed, node)} className="absolute top-0 left-0 will-change-transform" data-label={blob.seed} data-fx-key={moment?.key}>
        {/* The effects zoom with the world, from the blob's feet. */}
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: "scale(var(--camera-zoom, 1))" }}>
          {moment ? <InteractionFx moment={moment} size={size} /> : blob.aura ? <AuraFx aura={blob.aura} size={size} /> : null}
        </div>
        {/* Clicking a name selects its blob, even one hidden behind another. */}
        <p
          className="pointer-events-auto absolute flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border-2 border-ink bg-card px-2 py-px text-xs font-semibold text-ink shadow-[0_2px_0_var(--ink)] transition-colors hover:bg-sun"
          style={{ bottom: `calc(${blobSize * 0.84}px * var(--camera-zoom, 1))`, transform: "translateX(-50%)" }}
          onClick={(e) => {
            e.stopPropagation();
            select(blob.seed);
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
        {/* The blob itself, for the keyboard: focus outlines it, Enter follows it. */}
        <button
          type="button"
          className="sr-only"
          aria-label={t.card.follow(blob.label)}
          aria-pressed={selected}
          onFocus={(e) => focus(e.currentTarget.matches(":focus-visible") ? blob.seed : null)}
          onBlur={() => focus(null)}
          onClick={(e) => {
            e.stopPropagation();
            select(blob.seed);
          }}
        />
      </div>
    );
  },
  (a, b) =>
    sameShown(a.blob, b.blob) && a.size === b.size && a.blobSize === b.blobSize && a.selected === b.selected && a.place === b.place && a.select === b.select && a.focus === b.focus && sameMoment(a.moment, b.moment),
);

/**
 * Edit mode: one clickable diamond per walkable cell, over the island's box.
 * Press and drag to paint several cells in one stroke. The nest's cell is locked.
 */
function EditGrid({
  layout,
  island,
  box,
  onCellPaint,
}: {
  layout: IslandLayout;
  island: IslandGeometry;
  box: { left: number; top: number; w: number; h: number };
  onCellPaint: (cell: number) => void;
}) {
  const tiles = layout.size;
  const locked = nestCell(tiles);
  const t = useT();
  // Grid point, on cell (i, j)'s surface -> island pack px (the SVG's viewBox).
  const pt = (i: number, j: number, u: number, v: number) => {
    const { x, y } = island.at(u, v, surfaceHeight(layout, i, j, u, v));
    return `${x},${y}`;
  };
  // Back to front, so a raised cell's diamond covers the ones behind it.
  const order = Array.from({ length: tiles * tiles }, (_, n) => n).sort(
    (a, b) => (a % tiles) + Math.floor(a / tiles) - ((b % tiles) + Math.floor(b / tiles)),
  );
  return (
    <svg
      className="absolute"
      style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
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
            <title>{isLocked ? t.editor.nest : t.editor.cell(i + 1, j + 1)}</title>
          </polygon>
        );
      })}
    </svg>
  );
}

const ACTIVITY_ICONS = { sleep: Moon, wake: Sunrise, rest: Coffee, explore: Footprints, discover: Sparkles, meet: Users } as const;
export function ActivityIcon({ activity, className = "size-3" }: { activity: Activity; className?: string }) {
  const t = useT();
  const Icon = ACTIVITY_ICONS[activity];
  return <Icon className={className} aria-label={t.activity[activity]} role="img" />;
}

// Expressions are objects, so a mood is looked up by identity; its words are in i18n, by key.
const MOODS = new Map<Expression, { key: keyof Messages["mood"]; emoji: string }>([
  [idle, { key: "idle", emoji: "😌" }],
  [happy, { key: "happy", emoji: "😊" }],
  [sleepy, { key: "sleepy", emoji: "😴" }],
  [surprised, { key: "surprised", emoji: "😮" }],
  [thinking, { key: "thinking", emoji: "🤔" }],
  [love, { key: "love", emoji: "🥰" }],
  [sad, { key: "sad", emoji: "😢" }],
  [mad, { key: "mad", emoji: "😠" }],
  [shy, { key: "shy", emoji: "😳" }],
  [wink, { key: "wink", emoji: "😉" }],
  [smug, { key: "smug", emoji: "😏" }],
  [unsure, { key: "unsure", emoji: "😕" }],
  [scared, { key: "scared", emoji: "😨" }],
]);
export const moodOf = (expression: Expression) => MOODS.get(expression);

export function MoodIcon({ expression }: { expression: Expression }) {
  const t = useT();
  const mood = moodOf(expression);
  const label = mood && t.mood[mood.key];
  return mood ? (
    <span role="img" aria-label={label} title={label}>
      {mood.emoji}
    </span>
  ) : null;
}
