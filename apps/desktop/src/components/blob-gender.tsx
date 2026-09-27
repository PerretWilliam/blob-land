import { ATTRACTIONS, SEXES, type Attraction, type Identity, type Sex } from "@blob-land/sim";
import { blobatar } from "blobatar";
import { useLayoutEffect, useRef } from "react";

export const SEX_LABELS: Record<Sex, string> = { female: "Female", male: "Male", none: "Neither" };
export const ATTRACTION_LABELS: Record<Attraction, string> = { women: "Women", men: "Men", any: "Anyone" };

/** Where the sign sits on a blob, in the blobatar's own 0–100 viewBox. */
interface Anchor {
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

const blobSvgOf = (sign: SVGSVGElement | null) => sign?.parentElement?.querySelector<SVGSVGElement>("svg:not([data-gender])") ?? null;

/**
 * Makes the sign move exactly like the blob: blobatar animates groups inside
 * its own SVG (breathing, bobbing, the hover lift), which a sibling SVG can't
 * be part of — blobatar owns its markup and rewrites it. So the sign copies
 * the blob's motion variables, runs the same motion classes, and lines its
 * animation clocks up with the blob's own.
 */
function mirrorMotion(sign: SVGSVGElement, blob: SVGSVGElement) {
  sign.setAttribute("style", blob.getAttribute("style") ?? "");
  for (const cls of ["mo-root", "mo-breathe", "mo-bob"]) {
    const [theirs, ours] = [blob.querySelector(`.${cls}`), sign.querySelector(`.${cls}`)];
    if (!theirs || !ours) continue;
    const clock = new Map(theirs.getAnimations().map((a) => [(a as CSSAnimation).animationName, a.startTime]));
    for (const a of ours.getAnimations()) {
      const start = clock.get((a as CSSAnimation).animationName);
      if (start !== undefined && a.startTime !== start) a.startTime = start;
    }
  }
}

/**
 * The little sign that says a blob's sex: a bow for a girl, a bowler hat for
 * a boy, nothing for neither. Laid over the blobatar at the same size, inside
 * the body wrapper, so it rides along with every hop and wobble — and
 * breathes and bobs along with the blob itself (see mirrorMotion).
 */
export function BlobGenderSign({ seed, sex, size, animated }: { seed: string; sex: Sex; size: number; animated: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const key = `${seed}|${sex}`;
  if (sex !== "none" && !anchors.has(key)) anchors.set(key, measure(seed, sex === "female" ? -9 : 0));
  const anchor = anchors.get(key) ?? null;

  // Every render: the blob's motion variables change with its expression.
  useLayoutEffect(() => {
    const blob = blobSvgOf(ref.current);
    if (animated && anchor && ref.current && blob) mirrorMotion(ref.current, blob);
  });

  if (sex === "none") return null;
  const sign = anchor ? (
    <g transform={`translate(${anchor.x} ${anchor.y}) rotate(${anchor.tilt + (sex === "female" ? -18 : 0)})`}>
      {sex === "female" ? <Bow /> : <Bowler />}
    </g>
  ) : null;
  return (
    <svg
      ref={ref}
      data-gender
      aria-hidden="true"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      {animated ? (
        <g className="mo-root mo-always">
          <g className="mo-breathe">
            <g className="mo-bob">{sign}</g>
          </g>
        </g>
      ) : (
        sign
      )}
    </svg>
  );
}

// Both drawn around (0, 0): the spot on the head where they're worn.
function Bow() {
  return (
    <g stroke="#3b0a1e" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M0 -1 C -4 -10 -14 -11 -13 -3 C -12 3 -4 2 0 -1 Z" fill="#ff5fa2" />
      <path d="M0 -1 C 4 -10 14 -11 13 -3 C 12 3 4 2 0 -1 Z" fill="#ff5fa2" />
      <path d="M-9 -5 Q -6 -6 -3 -3 M9 -5 Q 6 -6 3 -3" fill="none" stroke="#c2185b" strokeWidth="1.2" />
      <ellipse cx="0" cy="-1" rx="3.2" ry="3.6" fill="#e91e63" />
    </g>
  );
}

function Bowler() {
  return (
    <g stroke="#0d1120" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M-15 1 Q 0 -3 15 1 Q 16 3 13 3.5 Q 0 0.5 -13 3.5 Q -16 3 -15 1 Z" fill="#2b3350" />
      <path d="M-9 0 C -10 -14 10 -14 9 0 Z" fill="#2b3350" />
      <path d="M-9.2 -2.6 Q 0 -4.4 9.2 -2.6 L 9 0 Q 0 -1.8 -9 0 Z" fill="#c9a44c" strokeWidth="1.1" />
      <path d="M-4 -10 Q -1 -12 2 -11.5" fill="none" stroke="#6f7aa3" strokeWidth="1.3" strokeLinecap="round" />
    </g>
  );
}

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
