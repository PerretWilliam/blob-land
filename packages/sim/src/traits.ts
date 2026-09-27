import { traits as blobatarTraits, type TraitOverrides } from "blobatar";
import type { Rng } from "./rng";

/** A parent going into a union: an account/seed-only blob has no stored
 * overrides (`traits: null`, its look comes straight from its seed); a child
 * blob has the frozen `TraitOverrides` written for it at birth. */
export interface Parent {
  seed: string;
  traits: TraitOverrides | null;
}

/**
 * The identity trait keys childTraits mixes — verified against blobatar
 * 2.7.0's actual read sites (`styles/compose.ts`, `styles/shapes.ts`,
 * `render.ts`), not guessed from key names.
 *
 * Deliberately excludes:
 * - `motion.*` (animate.ts): idle-loop timing/phase, re-rolled by blobatar
 *   itself every render — not a heritable appearance trait.
 * - Per-decoration index keys (`body.rN`, `nub.aN`/`rN`, `cloud.rN`): a
 * private surface whose count depends on a categorical key (body.pts,
 * nub.n, cloud.n) chosen per parent, so there's no stable key set to mix
 * across two different parents. The winning parent's own values for these
 * carry over implicitly since they're outside this list (see below).
 *
 * ponytail: this list is frozen against blobatar's public trait surface as
 * read today; bump it if a future blobatar major adds new identity keys.
 */
const GENETIC_KEYS = [
  "shape",
  "hue",
  "tone",
  "body.n",
  "body.r",
  "body.ratio",
  "body.rot",
  "body.pts",
  "eye.gap",
  "eye.lean",
  "eye.lean2",
  "eye.n",
  "eye.ratio",
  "eye.rx",
  "eye.scale",
  "eye.stretch",
  "eye.dy",
  "gaze.x",
  "gaze.y",
  "capsule.squat",
  "droplet.tip",
  "poly.round",
  "sun.dist",
  "sun.r",
  "sun.rot",
  "cloud.n",
  "nub.n",
  "sun.n",
] as const;

// Keys read via t.pick/t.int-as-discriminator or t.int-as-count: blending the
// position would land between two silhouettes/counts rather than at either,
// so these are inherited whole from one parent, never lerped.
const CATEGORICAL_KEYS = new Set<string>(["shape", "body.pts", "cloud.n", "nub.n", "sun.n"]);

function effectiveTraits(parent: Parent): Record<string, number> {
  const t = blobatarTraits(parent.seed, true, parent.traits ?? undefined);
  const out: Record<string, number> = {};
  for (const key of GENETIC_KEYS) out[key] = t(key);
  return out;
}

/**
 * A random genetic mix of two parents' effective traits (their stored
 * `blobs.traits`, or their seed's own look for an unmixed account blob).
 * Categorical keys inherit whole from one parent or the other; continuous
 * keys lerp. Frozen at birth: store the result as-is in `blobs.traits`.
 */
export function childTraits(parentA: Parent, parentB: Parent, rng: Rng): Record<string, number> {
  const a = effectiveTraits(parentA);
  const b = effectiveTraits(parentB);
  const child: Record<string, number> = {};

  for (const key of GENETIC_KEYS) {
    if (CATEGORICAL_KEYS.has(key)) {
      child[key] = rng() < 0.5 ? a[key]! : b[key]!;
    } else {
      const w = rng();
      child[key] = a[key]! + (b[key]! - a[key]!) * w;
    }
  }
  return child;
}
