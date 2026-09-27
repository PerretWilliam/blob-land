import { childPersonality, compatible, randomIdentity, type Identity, type Personality } from "./identity";
import {
  deltaFor,
  interactionExpression,
  moodShift,
  pickInteraction,
  rollOutcome,
  type InteractionKind,
  type MeetingContext,
  type Outcome,
} from "./interactions";
import { canSocialize, DURATION, firstSegment, liveThrough, nextSolo, type Segment, type Vitals } from "./life";
import {
  applyDelta,
  decay,
  newRelationship,
  pairKey,
  readyForUnion,
  readyToBreakUp,
  relationStatus,
  type Delta,
  type Kin,
  type RelationStatus,
  type Relationship,
} from "./relationship";
import { between, randomSeed, weighted, type Rng } from "./rng";
import { childTraits } from "./traits";

/** Everything the world step needs to know about one blob. */
export interface WorldBlob {
  seed: string;
  identity: Identity;
  personality: Personality;
  bornAt: number;
  /** Romance waits until then. An account's blob is born grown up. */
  adultAt: number;
  parents: [string, string] | null;
  /** Frozen look for a child; null when the seed alone draws it. */
  traits: Record<string, number> | null;
  vitals: Vitals;
  /** Its latest segment: the next one starts where and when this one ends. */
  last: Segment;
}

export interface Union {
  id: string;
  a: string;
  b: string;
  startedAt: number;
  endedAt: number | null;
  lastBirthAt: number | null;
}

export interface World {
  blobs: Map<string, WorldBlob>;
  relationships: Map<string, Relationship>;
  /** Active unions (ended ones may be left in; they're ignored). */
  unions: Union[];
}

export interface Meeting {
  id: string;
  a: string;
  b: string;
  kind: InteractionKind;
  outcome: Outcome;
  /** When both are there (the earlier one waits for the other). */
  start: number;
  end: number;
  rng: number;
  delta: Delta;
}

export interface Birth {
  child: WorldBlob;
  unionId: string;
}

/** What one step produced, for the caller to store. */
export interface WorldStep {
  segments: (Segment & { seed: string })[];
  meetings: Meeting[];
  /** Every relationship that changed, as it now stands. */
  relationships: Relationship[];
  unionsStarted: Union[];
  unionsEnded: Union[];
  births: Birth[];
}

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// How long a blob that wants company waits for someone to come free.
const SOCIAL_WAIT = 5 * MIN;
// Half the distance two blobs keep while together, per ground axis.
const GAP = 0.04;
// Births slow down as the garden fills, and stop here.
// ponytail: one soft cap for the whole garden; per-couple limits if it ever feels samey.
export const POPULATION_CAP = 150;
const BIRTH_COOLDOWN = 3 * DAY;
export const ADULT_AFTER_DAYS = [8, 12] as const;

// How much a blob would rather see someone, by how they get on.
const MEET_WEIGHT: Record<RelationStatus, number> = {
  strangers: 1,
  acquaintances: 1.5,
  friends: 3,
  best_friends: 5,
  crush: 6,
  lovers: 7,
  complicated: 2,
  rivals: 0.6,
  ex: 0.4,
  family: 4,
};

/**
 * Lives the whole world forward until every blob's timeline reaches
 * `until`, always extending whoever is furthest behind. A blob finishing a
 * segment may look for company among those about to finish theirs; the rest
 * of the time it carries on alone. Mutates `world`; returns what happened.
 *
 * `maxCatchUp`: a blob further behind than this skips the gap instead of
 * living through it (the app was closed for a week, the server was down).
 */
export function stepWorld(world: World, until: number, rng: Rng, maxCatchUp = 2 * DAY): WorldStep {
  const out: WorldStep = { segments: [], meetings: [], relationships: [], unionsStarted: [], unionsEnded: [], births: [] };
  const touched = new Map<string, Relationship>();

  for (const blob of world.blobs.values()) {
    if (blob.last.end >= until - maxCatchUp) continue;
    blob.last = firstSegment(until - maxCatchUp, rng, blob.last);
    blob.vitals = { energy: 0.8, mood: 0.15 };
  }

  const push = (blob: WorldBlob, seg: Segment) => {
    blob.vitals = liveThrough(blob.vitals, seg);
    blob.last = seg;
    out.segments.push({ ...seg, seed: blob.seed });
  };

  for (;;) {
    let b: WorldBlob | undefined;
    for (const blob of world.blobs.values()) if (blob.last.end < until && (!b || blob.last.end < b.last.end)) b = blob;
    if (!b) break;

    const t = b.last.end;
    const wantsCompany = 0.05 + 0.3 * b.personality.sociability + 0.1 * b.vitals.mood;
    if (canSocialize(b.last, b.vitals, t) && rng() < wantsCompany) {
      const c = pickCompany(world, b, t, rng);
      if (c) {
        meet(world, b, c, rng, out, touched, push);
        continue;
      }
    }
    push(b, nextSolo(b.last, b.vitals, rng));
  }

  out.relationships = [...touched.values()];
  return out;
}

function pickCompany(world: World, b: WorldBlob, t: number, rng: Rng): WorldBlob | undefined {
  const weights: Record<string, number> = {};
  for (const c of world.blobs.values()) {
    if (c === b || c.last.end < t || c.last.end > t + SOCIAL_WAIT) continue;
    if (!canSocialize(c.last, c.vitals, c.last.end)) continue;
    const status = world.relationships.get(pairKey(b.seed, c.seed))?.status ?? "strangers";
    weights[c.seed] = MEET_WEIGHT[status] * (0.3 + c.personality.sociability);
  }
  if (Object.keys(weights).length === 0) return undefined;
  return world.blobs.get(weighted(rng, weights));
}

const activeUnion = (world: World, seed: string) => world.unions.find((u) => u.endedAt === null && (u.a === seed || u.b === seed));

function meet(
  world: World,
  b: WorldBlob,
  c: WorldBlob,
  rng: Rng,
  out: WorldStep,
  touched: Map<string, Relationship>,
  push: (blob: WorldBlob, seg: Segment) => void,
) {
  const key = pairKey(b.seed, c.seed);
  // `b` got here first and waits for `c`.
  const start = c.last.end;
  const end = start + between(rng, DURATION.meet[0], DURATION.meet[1]);
  const union = activeUnion(world, b.seed);
  const together = union !== undefined && (union.a === c.seed || union.b === c.seed);
  let rel = decay(world.relationships.get(key) ?? newRelationship(b.seed, c.seed, rng), start, together);

  const young = (x: WorldBlob) => start < x.adultAt;
  const parentOf = (p: WorldBlob, kid: WorldBlob) => kid.parents?.includes(p.seed) ?? false;
  const ctx: MeetingContext = {
    rel,
    canRomance: !rel.kin && !young(b) && !young(c) && compatible(b.identity, c.identity),
    parentAndChild: (parentOf(b, c) && young(c)) || (parentOf(c, b) && young(b)),
    moodA: b.vitals.mood,
    moodB: c.vitals.mood,
    temper: (b.personality.temper + c.personality.temper) / 2,
    playfulness: (b.personality.playfulness + c.personality.playfulness) / 2,
    romance: (b.personality.romance + c.personality.romance) / 2,
  };
  const kind = pickInteraction(ctx, rng);
  const outcome = rollOutcome(ctx, rng);
  const delta = deltaFor(kind, outcome, ctx, rng);
  rel = applyDelta(rel, delta, end, together);

  // Meet halfway, a little off to the side, and stand side by side.
  const clamp = (v: number) => Math.min(0.85, Math.max(0.15, v));
  const mx = clamp((b.last.x + c.last.x) / 2 + between(rng, -0.1, 0.1));
  const my = clamp((b.last.y + c.last.y) / 2 + between(rng, -0.1, 0.1));
  const shared = { end, activity: "meet" as const, expression: interactionExpression(kind, outcome), rng: randomSeed(rng), detail: `${kind}:${outcome}` };
  out.meetings.push({ id: crypto.randomUUID(), a: rel.a, b: rel.b, kind, outcome, start, end, rng: shared.rng, delta });
  push(b, { ...shared, start: b.last.end, x: mx - GAP, y: my + GAP, with: c.seed });
  push(c, { ...shared, start, x: mx + GAP, y: my - GAP, with: b.seed });
  const shift = moodShift(kind, outcome);
  for (const x of [b, c]) x.vitals = { ...x.vitals, mood: Math.min(1, Math.max(-1, x.vitals.mood + shift)) };

  if (together && readyToBreakUp(rel)) {
    union.endedAt = end;
    out.unionsEnded.push(union);
    rel = { ...rel, ex: true, romance: Math.max(0, rel.romance - 20) };
    rel = { ...rel, status: relationStatus(rel, false) };
  } else if (!together && ctx.canRomance && readyForUnion(rel) && !union && !activeUnion(world, c.seed)) {
    const started: Union = { id: crypto.randomUUID(), a: rel.a, b: rel.b, startedAt: end, endedAt: null, lastBirthAt: null };
    world.unions.push(started);
    out.unionsStarted.push(started);
    rel = { ...rel, status: relationStatus(rel, true) };
  } else if (together && outcome === "good" && (kind === "hug" || kind === "kiss" || kind === "dance")) {
    const room = Math.max(0, 1 - world.blobs.size / POPULATION_CAP);
    const rested = union.lastBirthAt === null || end - union.lastBirthAt >= BIRTH_COOLDOWN;
    if (rested && rng() < 0.12 * room) born(world, union, b, c, { x: mx, y: my + GAP * 2 }, end, rng, out, touched);
  }
  world.relationships.set(key, rel);
  touched.set(key, rel);
}

function born(
  world: World,
  union: Union,
  b: WorldBlob,
  c: WorldBlob,
  where: { x: number; y: number },
  at: number,
  rng: Rng,
  out: WorldStep,
  touched: Map<string, Relationship>,
) {
  const parents = [b.seed, c.seed].sort() as [string, string];
  const child: WorldBlob = {
    seed: `child-${crypto.randomUUID()}`,
    identity: randomIdentity(rng),
    personality: childPersonality(b.personality, c.personality, rng),
    bornAt: at,
    adultAt: at + between(rng, ADULT_AFTER_DAYS[0], ADULT_AFTER_DAYS[1]) * DAY,
    parents,
    traits: childTraits({ seed: b.seed, traits: b.traits }, { seed: c.seed, traits: c.traits }, rng),
    vitals: { energy: 0.9, mood: 0.4 },
    last: firstSegment(at, rng, where),
  };
  // Family from day one: both parents, and anyone sharing a parent.
  const kin = (other: string, k: Kin) => {
    const rel = newRelationship(child.seed, other, rng, k);
    world.relationships.set(pairKey(child.seed, other), rel);
    touched.set(pairKey(child.seed, other), rel);
  };
  for (const p of parents) kin(p, "parent");
  for (const other of world.blobs.values()) if (other.parents?.some((p) => parents.includes(p))) kin(other.seed, "sibling");

  world.blobs.set(child.seed, child);
  union.lastBirthAt = at;
  out.births.push({ child, unionId: union.id });
}
