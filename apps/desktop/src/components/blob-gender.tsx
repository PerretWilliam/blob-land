import { ATTRACTIONS, SEXES, type Attraction, type Identity, type Sex } from "@blob-land/sim";
import { Blobatar } from "@blobatar/react";
import { _posed } from "blobatar/internal";
import type { ReactNode } from "react";
import { useT } from "@/i18n";

/** Where the sign sits on a blob, in the blobatar's own 0–100 viewBox. */
export interface Anchor {
  x: number;
  y: number;
  /** Slope of the silhouette there, in degrees, so the sign sits flush. */
  tilt: number;
}

// Measured once per seed and sign: a blob's silhouette never changes.
const anchors = new Map<string, Anchor | null>();

/**
 * Samples the outline of the blob's body — every shape blobatar draws for
 * it — and finds the top of its head. Blobs come in ten silhouettes, rotated
 * and squashed, so the top is measured, not assumed. `offset` slides along
 * the head (negative = to the left), for a bow worn on the side.
 */
function measure(seed: string, offset: number): Anchor | null {
  return measureBody(_posed(seed).marks.flatMap((mark) => (mark.kind === "circle" ? circlePoints(mark.cx, mark.cy, mark.r) : pathPoints(mark.d))), offset);
}

// Points sampled along each shape, evenly by length (as SVG's getPointAtLength would).
const SAMPLES = 96;

function circlePoints(cx: number, cy: number, r: number): { x: number; y: number }[] {
  return Array.from({ length: SAMPLES }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / SAMPLES), y: cy + r * Math.sin((2 * Math.PI * i) / SAMPLES) }));
}

/** A path of absolute M, L, H, V, Q, C and Z, as blobatar writes them: curves are cut into short lines first. */
function pathPoints(d: string): { x: number; y: number }[] {
  const line: { x: number; y: number }[] = [];
  const tokens = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  let [x, y, x0, y0] = [0, 0, 0, 0];
  let command = "";
  for (let k = 0; k < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[k]!)) command = tokens[k++]!;
    const n = () => Number(tokens[k++]);
    switch (command) {
      case "M":
        [x, y] = [n(), n()];
        [x0, y0] = [x, y];
        line.push({ x, y });
        command = "L";
        break;
      case "L":
        [x, y] = [n(), n()];
        line.push({ x, y });
        break;
      case "H":
        x = n();
        line.push({ x, y });
        break;
      case "V":
        y = n();
        line.push({ x, y });
        break;
      case "Q": {
        const [cx, cy, ex, ey] = [n(), n(), n(), n()];
        for (let i = 1; i <= 32; i++) {
          const t = i / 32;
          line.push({ x: (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex, y: (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey });
        }
        [x, y] = [ex, ey];
        break;
      }
      case "C": {
        const [c1x, c1y, c2x, c2y, ex, ey] = [n(), n(), n(), n(), n(), n()];
        for (let i = 1; i <= 32; i++) {
          const [t, u] = [i / 32, 1 - i / 32];
          line.push({ x: u ** 3 * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex, y: u ** 3 * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey });
        }
        [x, y] = [ex, ey];
        break;
      }
      case "Z":
        [x, y] = [x0, y0];
        line.push({ x, y });
        command = "";
        break;
      default:
        k++;
    }
  }
  const reach = [0];
  for (let i = 1; i < line.length; i++) reach.push(reach[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y));
  const length = reach[reach.length - 1] ?? 0;
  const points: { x: number; y: number }[] = [];
  for (let i = 0, j = 1; i < SAMPLES && line.length > 1; i++) {
    const at = (length * i) / SAMPLES;
    while (j < line.length - 1 && reach[j]! < at) j++;
    const f = reach[j]! === reach[j - 1]! ? 0 : (at - reach[j - 1]!) / (reach[j]! - reach[j - 1]!);
    points.push({ x: line[j - 1]!.x + (line[j]!.x - line[j - 1]!.x) * f, y: line[j - 1]!.y + (line[j]!.y - line[j - 1]!.y) * f });
  }
  return points;
}

function measureBody(points: { x: number; y: number }[], offset: number): Anchor | null {
  if (points.length === 0) return null;
  // The highest point, then the middle of the flat-ish crown around it.
  const top = Math.min(...points.map((p) => p.y));
  const crown = points.filter((p) => p.y <= top + 3);
  const x = crown.reduce((s, p) => s + p.x, 0) / crown.length + offset;
  // The outline's top edge in a thin slice around any x.
  const edge = (at: number) => Math.min(Infinity, ...points.filter((p) => Math.abs(p.x - at) < 2.5).map((p) => p.y));
  const [y, left, right] = [edge(x), edge(x - 4), edge(x + 4)];
  if (!Number.isFinite(y)) return { x: x - offset, y: top, tilt: 0 };
  const slope = Number.isFinite(left) && Number.isFinite(right) ? (Math.atan2(right - left, 8) * 180) / Math.PI : 0;
  return { x, y, tilt: Math.max(-30, Math.min(30, slope)) };
}

/** Where a blob wears its sign, measured once per seed and sex; null for neither. */
export function genderAnchor(seed: string, sex: Sex): Anchor | null {
  if (sex === "none") return null;
  const key = `${seed}|${sex}`;
  if (!anchors.has(key)) anchors.set(key, measure(seed, sex === "female" ? -9 : 0));
  return anchors.get(key) ?? null;
}

/** A shape of a sign, in blobatar viewBox units around the spot where it's worn. */
export type SignShape =
  | { d: string; fill?: string; stroke: string; width: number; cap?: "round" }
  | { ellipse: [number, number, number, number]; fill: string; stroke: string; width: number };

/**
 * The little sign that says a blob's sex: a bow for a girl (worn tilted, on
 * the side), a bowler hat for a boy, nothing for neither. Drawn by the world
 * inside the blob's own motion groups, so it breathes and bobs with it.
 */
export const SIGNS: Record<"female" | "male", { tilt: number; shapes: SignShape[] }> = {
  female: {
    tilt: -18,
    shapes: [
      { d: "M0 -1 C -4 -10 -14 -11 -13 -3 C -12 3 -4 2 0 -1 Z", fill: "#ff5fa2", stroke: "#3b0a1e", width: 1.6 },
      { d: "M0 -1 C 4 -10 14 -11 13 -3 C 12 3 4 2 0 -1 Z", fill: "#ff5fa2", stroke: "#3b0a1e", width: 1.6 },
      { d: "M-9 -5 Q -6 -6 -3 -3 M9 -5 Q 6 -6 3 -3", stroke: "#c2185b", width: 1.2 },
      { ellipse: [0, -1, 3.2, 3.6], fill: "#e91e63", stroke: "#3b0a1e", width: 1.6 },
    ],
  },
  male: {
    tilt: 0,
    shapes: [
      { d: "M-15 1 Q 0 -3 15 1 Q 16 3 13 3.5 Q 0 0.5 -13 3.5 Q -16 3 -15 1 Z", fill: "#2b3350", stroke: "#0d1120", width: 1.6 },
      { d: "M-9 0 C -10 -14 10 -14 9 0 Z", fill: "#2b3350", stroke: "#0d1120", width: 1.6 },
      { d: "M-9.2 -2.6 Q 0 -4.4 9.2 -2.6 L 9 0 Q 0 -1.8 -9 0 Z", fill: "#c9a44c", stroke: "#0d1120", width: 1.1 },
      { d: "M-4 -10 Q -1 -12 2 -11.5", stroke: "#6f7aa3", width: 1.3, cap: "round" },
    ],
  },
};

/** A sign's shapes, as SVG, around (0, 0): the spot where it's worn. */
function SignShapes({ sex }: { sex: "female" | "male" }) {
  return SIGNS[sex].shapes.map((shape, i) =>
    "ellipse" in shape ? (
      <ellipse key={i} cx={shape.ellipse[0]} cy={shape.ellipse[1]} rx={shape.ellipse[2]} ry={shape.ellipse[3]} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.width} />
    ) : (
      <path key={i} d={shape.d} fill={shape.fill ?? "none"} stroke={shape.stroke} strokeWidth={shape.width} strokeLinecap={shape.cap ?? "butt"} strokeLinejoin="round" />
    ),
  );
}

/** A blob as the garden draws it: its blobatar, wearing its sex's sign. Still: the sign doesn't breathe with it. */
export function DressedBlob({ seed, sex, className = "size-16" }: { seed: string; sex: Sex; className?: string }) {
  const anchor = genderAnchor(seed, sex);
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      <Blobatar name={seed} className="block size-full" />
      {anchor && sex !== "none" ? (
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <g transform={`translate(${anchor.x} ${anchor.y}) rotate(${anchor.tilt + SIGNS[sex].tilt})`}>
            <SignShapes sex={sex} />
          </g>
        </svg>
      ) : null}
    </span>
  );
}

/** Who a blob falls for, as signs: a bow, a hat, or both. */
function AttractionIcon({ attraction }: { attraction: Attraction }) {
  const signs = attraction === "women" ? (["female"] as const) : attraction === "men" ? (["male"] as const) : (["female", "male"] as const);
  return (
    <svg viewBox={`-17 -15 ${34 * signs.length} 22`} className="h-5 w-auto" aria-hidden="true">
      {signs.map((sex, i) => (
        <g key={sex} transform={`translate(${34 * i} 0)`}>
          <SignShapes sex={sex} />
        </g>
      ))}
    </svg>
  );
}

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 rounded-xl border-[2.5px] border-ink px-2 py-1.5 text-sm font-semibold transition-[background-color,translate] ${pressed ? "bg-sun shadow-[0_3px_0_var(--ink)]" : "bg-white hover:-translate-y-px hover:bg-accent"}`}
    >
      {children}
    </button>
  );
}

/**
 * Who `seed`'s blob is and who it falls for: its sex as three pictures of it
 * wearing each sign, its attraction as the signs it's drawn to.
 */
export function IdentityFields({ seed, value, onChange }: { seed: string; value: Identity; onChange: (identity: Identity) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="mb-1.5 text-sm text-muted-foreground">{t.identity.is}</legend>
        <div className="flex gap-1.5">
          {SEXES.map((sex) => (
            <Choice key={sex} pressed={value.sex === sex} onClick={() => onChange({ ...value, sex })}>
              <DressedBlob seed={seed} sex={sex} className="size-12" />
              {t.sex[sex]}
            </Choice>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm text-muted-foreground">{t.identity.fallsFor}</legend>
        <div className="flex gap-1.5">
          {ATTRACTIONS.map((attraction) => (
            <Choice key={attraction} pressed={value.attraction === attraction} onClick={() => onChange({ ...value, attraction })}>
              <AttractionIcon attraction={attraction} />
              {t.attraction[attraction]}
            </Choice>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
