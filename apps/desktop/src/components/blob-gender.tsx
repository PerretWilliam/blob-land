import { ATTRACTIONS, SEXES, type Attraction, type Identity, type Sex } from "@blob-land/sim";
import { blobatar } from "blobatar";

export const SEX_LABELS: Record<Sex, string> = { female: "Female", male: "Male", none: "Neither" };
export const ATTRACTION_LABELS: Record<Attraction, string> = { women: "Women", men: "Men", any: "Anyone" };

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
 * and squashed, so the top is measured, not assumed. Measured on a throwaway
 * copy of the blob's SVG: the one on screen may be an <img>, or not drawn yet.
 * `offset` slides along the head (negative = to the left), for a bow worn
 * on the side.
 */
function measure(seed: string, offset: number): Anchor | null {
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  box.innerHTML = blobatar(seed);
  document.body.append(box);
  try {
    return measureBody(box.querySelector("g[fill]"), offset);
  } finally {
    box.remove();
  }
}

function measureBody(body: Element | null, offset: number): Anchor | null {
  if (!body) return null;
  const points: { x: number; y: number }[] = [];
  for (const el of body.querySelectorAll<SVGGeometryElement>("path, circle, ellipse, rect")) {
    const length = el.getTotalLength();
    for (let i = 0; i < 96; i++) {
      const p = el.getPointAtLength((length * i) / 96);
      points.push({ x: p.x, y: p.y });
    }
  }
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

/** Sex and attraction pickers, as two rows of toggle buttons. */
export function IdentityFields({ value, onChange }: { value: Identity; onChange: (identity: Identity) => void }) {
  const row = <T extends string>(legend: string, options: readonly T[], labels: Record<T, string>, current: T, set: (v: T) => void) => (
    <fieldset>
      <legend className="mb-1.5 text-sm text-muted-foreground">{legend}</legend>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={current === o}
            onClick={() => set(o)}
            className={`flex-1 rounded-md border px-2 py-1.5 text-sm transition-colors ${current === o ? "border-foreground bg-foreground text-background" : "hover:bg-muted"}`}
          >
            {labels[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="flex flex-col gap-3">
      {row("Your blob is", SEXES, SEX_LABELS, value.sex, (sex) => onChange({ ...value, sex }))}
      {row("It falls for", ATTRACTIONS, ATTRACTION_LABELS, value.attraction, (attraction) => onChange({ ...value, attraction }))}
    </div>
  );
}
