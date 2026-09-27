/*
 * How a blob moves, as numbers: what `blobatar/motion.css` and the meeting
 * moves in index.css do with a stylesheet, for the WebGL world, which has
 * none. Nothing here is a new decision: every curve, duration and keyframe is
 * transcribed from those two stylesheets (blobatar's own `idle.ts` does the
 * same for its loops, and is used as is).
 */
import type { InteractionKind } from "@blob-land/sim";
import type { IdleFrame } from "blobatar/idle";
import type { Pose } from "blobatar/internal";

/** A CSS `cubic-bezier`, as a function of elapsed fraction (blobatar's solver, src/ease.ts). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = ((ax * t + bx) * t + cx) * t - x;
      if (Math.abs(err) < 1e-5) break;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

export const EASE = bezier(0.25, 0.1, 0.25, 1);
export const EASE_IN = bezier(0.42, 0, 1, 1);
export const EASE_OUT = bezier(0, 0, 0.58, 1);
export const EASE_IN_OUT = bezier(0.42, 0, 0.58, 1);
/** `.mo-root` morphs: 300ms onto an expression, 400ms back to idle. */
export const MORPH_IN = { ms: 300, ease: bezier(0.45, 0.05, 0.5, 1) };
export const MORPH_OUT = { ms: 400, ease: EASE_IN_OUT };
/** `.mo-root:hover`'s lift: 220ms up, 160ms back down. */
export const LIFT = { inMs: 220, outMs: 160, ease: bezier(0.23, 1, 0.32, 1) };

/**
 * A 2D affine transform, `x' = a x + c y + e`, `y' = b x + d y + f`, built
 * like an SVG transform list: each call multiplies on the right, so the
 * calls read in the same order as the list they transcribe.
 */
export class Affine {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  reset(): this {
    this.a = this.d = 1;
    this.b = this.c = this.e = this.f = 0;
    return this;
  }

  private mul(a: number, b: number, c: number, d: number, e: number, f: number): this {
    const { a: a0, b: b0, c: c0, d: d0 } = this;
    this.e += a0 * e + c0 * f;
    this.f += b0 * e + d0 * f;
    this.a = a0 * a + c0 * b;
    this.b = b0 * a + d0 * b;
    this.c = a0 * c + c0 * d;
    this.d = b0 * c + d0 * d;
    return this;
  }

  translate(x: number, y: number): this {
    return this.mul(1, 0, 0, 1, x, y);
  }

  /** Degrees, clockwise on screen, like SVG and CSS. */
  rotate(deg: number): this {
    const r = (deg * Math.PI) / 180;
    const [cos, sin] = [Math.cos(r), Math.sin(r)];
    return this.mul(cos, sin, -sin, cos, 0, 0);
  }

  scale(x: number, y = x): this {
    return this.mul(x, 0, 0, y, 0, 0);
  }
}

/** What a pose moves an eye about: its drawn centre and the lean baked into its path. */
export interface EyeFrame {
  cx: number;
  cy: number;
  rot: number;
}

/** `.mo-eye`: the pose, with the thinking seesaw's phase folded in (blobatar's `poseTransforms`). */
export function eyeTransform(out: Affine, e: EyeFrame, i: number, p: Pose, rockp: number): Affine {
  const wrap = i ? 1 : -1;
  const sel = i ? 1 : 0;
  const ph = sel * (1 - p.rock) + p.rock * ((1 + wrap * rockp) / 2);
  return out
    .reset()
    .translate(e.cx + p.edx * wrap, e.cy + p.edy + ph * p.edy2)
    .rotate((p.tilt + sel * p.tilt2) * wrap + e.rot * (1 - p.lock))
    .scale(p.esx + sel * p.esx2, p.esy + sel * p.esy2)
    .rotate(-e.rot)
    .translate(-e.cx, -e.cy);
}

/** `.mo-eye > *`: the blink and the glance's foreshortening (blobatar's `idleTransforms().glance`). */
export function glanceTransform(out: Affine, e: EyeFrame, i: number, f: IdleFrame): Affine {
  const side = i ? 1 : -1;
  return out
    .reset()
    .translate(e.cx, e.cy)
    .rotate(f.wrap.rot * side)
    .scale(1 + f.wrap.mx + f.wrap.side * side, 1 + f.wrap.sy)
    .rotate(e.rot)
    .scale(1, f.blink)
    .rotate(-e.rot)
    .translate(-e.cx, -e.cy);
}

/**
 * `.mo-root`: the tremor, and the hover lift (`translateY(-1.5px) scale(1.04)`
 * about the viewBox centre), `lift` of the way there.
 */
export function rootTransform(out: Affine, f: IdleFrame, lift: number): Affine {
  return out
    .reset()
    .translate(f.shake[0], f.shake[1])
    .translate(50, 50)
    .translate(0, -1.5 * lift)
    .scale(1 + 0.04 * lift)
    .translate(-50, -50);
}

/** `.mo-breathe`, about the viewBox centre. */
export const breatheTransform = (out: Affine, f: IdleFrame): Affine =>
  out.reset().translate(50, 50).scale(f.breathe[0], f.breathe[1]).translate(-50, -50);

/*
 * The meeting moves (index.css, `[data-still="1"] [data-move=…]`): how a
 * blob's body moves once it has arrived, stacked under the walk cycle. Each is
 * a CSS animation, kept as one: keyframes with the curve into each of them,
 * a duration, a delay, whether it loops or alternates. Translations are
 * fractions of the body's size (the stylesheet's %), rotations degrees.
 */
export interface BodyMove {
  tx: number;
  ty: number;
  rot: number;
  sx: number;
  sy: number;
}
const REST: BodyMove = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 };
/** `[offset, values, curve out of this keyframe]`, offsets in [0, 1]. */
type Keyframe = [number, Partial<BodyMove>, ((x: number) => number)?];

interface MoveAnimation {
  ms: number;
  delayMs: number;
  /** Plays once and holds its end (`forwards`), from when the blob arrived. */
  once: boolean;
  alternate: boolean;
  ease: (x: number) => number;
  frames: Keyframe[];
}

function moveAnimation(kind: InteractionKind, face: number, turn: number, count: number): MoveAnimation | null {
  const loop = (ms: number, frames: Keyframe[], ease = EASE, alternate = false, delayMs = 0): MoveAnimation => ({ ms, delayMs, once: false, alternate, ease, frames });
  const once = (ms: number, to: Partial<BodyMove>): MoveAnimation => ({ ms, delayMs: 0, once: true, alternate: false, ease: EASE_OUT, frames: [[0, {}], [1, to]] });
  switch (kind) {
    case "chat": // fx-nod, in turns
      return loop(
        count * 1800,
        [[0, { rot: 0 }], [0.1, { rot: 3 }], [0.18, { rot: -2 }], [0.26, { rot: 3 }], [0.34, { rot: -2 }], [0.44, { rot: 0 }], [1, { rot: 0 }]],
        EASE,
        false,
        turn * 1800,
      );
    case "argue": // fx-shake
      return loop(1200, [
        [0, { tx: 0 }], [0.05, { tx: -0.03 }], [0.1, { tx: 0.03 }], [0.15, { tx: -0.03 }], [0.2, { tx: 0.03 }],
        [0.25, { tx: -0.03 }], [0.3, { tx: 0.03 }], [0.35, { tx: 0 }], [1, { tx: 0 }],
      ]);
    case "play":
    case "parent_play": // fx-hop
      return loop(700, [[0, { ty: 0 }, EASE_OUT], [0.5, { ty: -0.12 }, EASE_IN], [1, { ty: 0 }]]);
    case "dance": // fx-sway
      return loop(900, [[0, { rot: -8, tx: -0.03, ty: 0 }], [1, { rot: 8, tx: 0.03, ty: -0.04 }]], EASE_IN_OUT, true);
    case "hug":
    case "kiss": // fx-lean
      return once(600, { rot: face * 9, tx: face * 0.12 });
    case "gift":
    case "make_up": // fx-offer
      return once(600, { rot: face * 5, tx: face * 0.05 });
    case "flirt": // fx-wiggle
      return loop(1200, [[0, { rot: -4 }], [1, { rot: 4 }]], EASE_IN_OUT, true);
    case "sulk": // fx-slump
      return once(800, { rot: face * -4, ty: 0.04, sx: 1.04, sy: 0.94 });
    case "ignore": // fx-turn-away
      return once(600, { rot: face * -8, tx: face * -0.04 });
    default:
      return null;
  }
}

/** Keyframes read at progress `u` in [0, 1], each interval on its own curve. */
function framesAt(anim: MoveAnimation, u: number): BodyMove {
  const { frames } = anim;
  let k = 0;
  while (k < frames.length - 2 && u >= frames[k + 1]![0]) k++;
  const [o0, v0, ease = anim.ease] = frames[k]!;
  const [o1, v1] = frames[k + 1]!;
  const x = o1 === o0 ? 1 : ease(Math.min(1, Math.max(0, (u - o0) / (o1 - o0))));
  const out = { ...REST };
  for (const key of Object.keys(REST) as (keyof BodyMove)[]) {
    const [a, b] = [v0[key] ?? REST[key], v1[key] ?? REST[key]];
    out[key] = a + (b - a) * x;
  }
  return out;
}

/**
 * A meeting move at page time `pageMs` (the loops all start at the page's
 * time origin, so everyone at a meeting is in step), `sinceMs` after the
 * blob arrived (when the one-shot moves play). Null when it has none.
 */
export function moveAt(kind: InteractionKind, face: number, turn: number, count: number, pageMs: number, sinceMs: number): BodyMove | null {
  const anim = moveAnimation(kind, face, turn, count);
  if (!anim) return null;
  if (anim.once) return framesAt(anim, Math.min(1, sinceMs / anim.ms));
  const local = pageMs - anim.delayMs;
  // Before its delay, the first keyframe holds (`both`).
  if (local < 0) return framesAt(anim, 0);
  const n = Math.floor(local / anim.ms);
  const f = local / anim.ms - n;
  return framesAt(anim, anim.alternate && n % 2 ? 1 - f : f);
}

/**
 * An expression change in flight: CSS transitions every pose channel (and
 * the fills) from wherever it is towards the new pose, on the clock of the
 * state it's heading to.
 */
export interface Morph {
  from: Pose;
  to: Pose;
  fromFill: { head: string; eye: string };
  toFill: { head: string; eye: string };
  start: number;
  ms: number;
  ease: (x: number) => number;
}

/** How far along a morph is at `now`, eased, in [0, 1]. */
export const morphProgress = (m: Morph, now: number) => (m.ms <= 0 ? 1 : m.ease(Math.min(1, Math.max(0, (now - m.start) / m.ms))));
