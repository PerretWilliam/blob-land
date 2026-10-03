import { childPersonality, compatible, randomIdentity, type Identity, type Personality } from "./identity";
import {
  allClose,
  deltaFor,
  feeling,
  joinsIn,
  moodShift,
  pickInteraction,
  pickTogether,
  rollOutcome,
  type InteractionKind,
  type MeetingContext,
  type Outcome,
  type Sky,
} from "./interactions";
import { canSocialize, DURATION, firstSegment, isNight, liveThrough, nextSolo, type Segment, type Vitals } from "./life";
import {
  affinity,
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
import { forecast, seasonAt, weatherAt, type Spell } from "./weather";

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
  /** Its sky, rolled on by each step with everything else. Clear when unset. */
  weather?: Spell[];
  /**
   * A visit to a private island. It's to see each other: they look for
   * company more, and wait longer for the other to come free. Couples neither
   * form nor split up, and no child is born: that's the garden's to decide.
   */
  visit?: boolean;
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

/**
 * A big moment in a blob's life, for its album. Kept once per (seed, kind,
 * key), the first time: `friends` (key "") is its first friend; `best_friends`,
 * `crush`, `couple` and `made_up` are keyed by the other blob, `child` by the
 * child, `first` by what was done (a first kiss, a first snowball fight…).
 * Breakups and fights aren't kept: an album holds the good times.
 */
export interface Milestone {
  seed: string;
  kind: "friends" | "best_friends" | "crush" | "couple" | "child" | "made_up" | "first";
  key: string;
  /** Who it was with: the other blob, or for a child, the other parent and the child. */
  with: string[];
  at: number;
}

// What a blob remembers doing for the first time, when it went well.
const FIRSTS: readonly InteractionKind[] = ["kiss", "stargaze", "shelter", "splash", "snowball", "snowman", "flowers", "leaf_pile", "fireflies"];
const WARM: readonly RelationStatus[] = ["acquaintances", "friends", "best_friends", "crush", "lovers"];

/** How many may stay on an island at once, besides its own blob. */
export const MAX_GUESTS = 5;

/**
 * How long a visit lasts, rolled on arrival: a few hours between strangers,
 * up to two days between those who are close.
 */
export function stayFor(rel: Pick<Relationship, "friendship" | "romance"> | null, rng: Rng): number {
  const close = Math.max(rel?.friendship ?? 0, rel?.romance ?? 0) / 100;
  return between(rng, 3, 12) * HOUR + close * between(rng, 0, 36) * HOUR;
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
  /** Candidates: whoever stores them keeps each (seed, kind, key) the first time only. */
  milestones: Milestone[];
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// How long a blob that wants company waits for someone to come free.
const SOCIAL_WAIT = 5 * MIN;
// On a visit, for the one they came to see.
const VISIT_WAIT = 15 * MIN;
// How far from the middle of a gathering each blob stands: two face each
// other, a bigger group makes a wider ring.
const RING = (n: number) => 0.057 + 0.012 * (n - 2);
// A gathering grows one blob at a time while this keeps rolling true.
const GROWS = (host: WorldBlob) => 0.12 + 0.3 * host.personality.sociability;
export const GROUP_MAX = 5;
// In a crowd, bonds move slower than one to one.
const CROWD = 0.7;
// Births slow down as the garden fills, and stop here.
// ponytail: one soft cap for the whole garden; per-couple limits if it ever feels samey.
export const POPULATION_CAP = 150;
const BIRTH_COOLDOWN = 5 * DAY;
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
  const out: WorldStep = { segments: [], meetings: [], relationships: [], unionsStarted: [], unionsEnded: [], births: [], milestones: [] };
  const touched = new Map<string, Relationship>();
  const weather = (world.weather = forecast(world.weather ?? [], until, rng, maxCatchUp));

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
    // A cheerful blob goes looking for company; a low one keeps to itself.
    const wantsCompany = 0.05 + 0.3 * b.personality.sociability + 0.2 * b.vitals.mood + (world.visit ? 0.15 : 0);
    if (canSocialize(b.last, b.vitals, t, b.personality.chronotype) && rng() < wantsCompany) {
      const group = [b];
      for (let c = pickCompany(world, group, t, rng); c; c = group.length < GROUP_MAX && rng() < GROWS(b) ? pickCompany(world, group, t, rng) : undefined) {
        group.push(c);
      }
      if (group.length > 1) {
        gather(world, group, rng, out, touched, push);
        continue;
      }
    }
    push(b, nextSolo(b.last, b.vitals, rng, b.personality.chronotype, b.personality.curiosity, weatherAt(weather, t)));
  }

  out.relationships = [...touched.values()];
  return out;
}

/**
 * Someone free soon to join `group`: whoever gets on best with those already
 * there, and preferably close by, so blobs gather with their neighbours
 * rather than trek across the garden.
 */
function pickCompany(world: World, group: WorldBlob[], t: number, rng: Rng): WorldBlob | undefined {
  const [cx, cy] = [mean(group.map((m) => m.last.x)), mean(group.map((m) => m.last.y))];
  const weights: Record<string, number> = {};
  for (const c of world.blobs.values()) {
    if (group.includes(c) || c.last.end < t || c.last.end > t + (world.visit ? VISIT_WAIT : SOCIAL_WAIT)) continue;
    if (!canSocialize(c.last, c.vitals, c.last.end, c.personality.chronotype)) continue;
    // Geometric mean: one rival already there is enough to put a blob off joining.
    const liking = Math.exp(mean(group.map((m) => Math.log(MEET_WEIGHT[world.relationships.get(pairKey(m.seed, c.seed))?.status ?? "strangers"]))));
    // Neighbours by far: a tenth of the garden away halves the draw, a third all but rules it out.
    const near = 1 / (1 + (Math.hypot(c.last.x - cx, c.last.y - cy) / 0.1) ** 2);
    weights[c.seed] = liking * near * (0.3 + c.personality.sociability);
  }
  if (Object.keys(weights).length === 0) return undefined;
  return world.blobs.get(weighted(rng, weights));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const activeUnion = (world: World, seed: string) => world.unions.find((u) => u.endedAt === null && (u.a === seed || u.b === seed));
const SCORE: Record<Outcome, number> = { good: 1, meh: 0, bad: -1 };
// Which relationship shows on a blob's face in a crowd, most telling first.
const SALIENCE: RelationStatus[] = ["lovers", "crush", "rivals", "ex", "complicated", "best_friends", "family", "friends", "acquaintances", "strangers"];

/**
 * Two or more blobs get together: they walk to a spot between them and stand
 * in a ring, and every pair among them has its own moment. Two blobs pick
 * what they do; a group does one thing together (a story, a song, a game of
 * tag, a ring dance, a group hug if they're all close…) — except
 * for pairs whose relationship won't have it, who bicker or snub each other
 * on the side, as rivals would.
 */
function gather(
  world: World,
  members: WorldBlob[],
  rng: Rng,
  out: WorldStep,
  touched: Map<string, Relationship>,
  push: (blob: WorldBlob, seg: Segment) => void,
) {
  const crowd = members.length > 2;
  // The last to finish what it was doing sets the start; the others wait.
  const start = Math.max(...members.map((m) => m.last.end));
  const end = start + between(rng, DURATION.meet[0], DURATION.meet[1]) * (crowd ? 1.5 : 1);
  const playful = mean(members.map((m) => m.personality.playfulness));
  const statuses = members.flatMap((m, i) => members.slice(i + 1).map((o) => world.relationships.get(pairKey(m.seed, o.seed))?.status ?? "strangers"));
  const found = members.some((m) => m.last.activity === "discover");
  const sky = { weather: weatherAt(world.weather ?? [], start), season: seasonAt(start), night: isNight(start) };
  const together: InteractionKind | null = crowd ? pickTogether(rng, playful, allClose(statuses), found, sky) : null;

  // Meet in the middle, a little off to the side.
  const clamp = (v: number) => Math.min(0.85, Math.max(0.15, v));
  const mx = clamp(mean(members.map((m) => m.last.x)) + between(rng, -0.1, 0.1));
  const my = clamp(mean(members.map((m) => m.last.y)) + between(rng, -0.1, 0.1));

  const scores = members.map((): number[] => []);
  const shifts = members.map((): number[] => []);
  // Who matters most to each of them there: that colours its face.
  const closest = members.map((): RelationStatus => "strangers");
  let kind: InteractionKind = "chat";
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const moment = pair(world, members[i]!, members[j]!, start, end, together, sky, rng, out, touched);
      kind = moment.kind;
      for (const k of [i, j]) {
        scores[k]!.push(SCORE[moment.outcome]);
        shifts[k]!.push(moodShift(moment.kind, moment.outcome, moment.status));
        if (SALIENCE.indexOf(moment.status) < SALIENCE.indexOf(closest[k]!)) closest[k] = moment.status;
      }
      if (!crowd) maybeBorn(world, members[0]!, members[1]!, moment.kind, moment.outcome, { x: mx, y: my + 0.08 }, end, rng, out, touched);
    }
  }

  const ring = RING(members.length);
  const turn = between(rng, 0, 2 * Math.PI);
  members.forEach((m, i) => {
    // How it went for this one, all its pairs taken together.
    const s = mean(scores[i]!);
    const outcome: Outcome = s > 0.3 ? "good" : s < -0.3 ? "bad" : "meh";
    const shown = together ?? kind;
    const angle = crowd ? turn + (2 * Math.PI * i) / members.length : (3 * Math.PI) / 4 + Math.PI * i;
    push(m, {
      start: m.last.end,
      end,
      activity: "meet",
      expression: feeling(shown, outcome, closest[i]!),
      x: mx + ring * Math.cos(angle),
      y: my + ring * Math.sin(angle),
      rng: randomSeed(rng),
      with: members.filter((o) => o !== m).map((o) => o.seed),
      detail: `${shown}:${outcome}`,
    });
    m.vitals = { ...m.vitals, mood: Math.min(1, Math.max(-1, m.vitals.mood + mean(shifts[i]!))) };
  });
}

/** One pair's moment within a gathering: what they did, how it went, and
 * what it did to them — a couple may form, or break up, right there. */
function pair(
  world: World,
  b: WorldBlob,
  c: WorldBlob,
  start: number,
  end: number,
  together: InteractionKind | null,
  sky: Sky,
  rng: Rng,
  out: WorldStep,
  touched: Map<string, Relationship>,
): { kind: InteractionKind; outcome: Outcome; status: RelationStatus } {
  const key = pairKey(b.seed, c.seed);
  // A milestone for each of them, keyed by the other unless `k` says otherwise.
  const both = (kind: Milestone["kind"], k?: string) => {
    for (const [x, o] of [[b, c], [c, b]] as const) out.milestones.push({ seed: x.seed, kind, key: k ?? o.seed, with: [o.seed], at: end });
  };
  const union = activeUnion(world, b.seed);
  const couple = union !== undefined && (union.a === c.seed || union.b === c.seed);
  let rel = decay(world.relationships.get(key) ?? newRelationship(b.seed, c.seed, rng, null, affinity(b.personality, c.personality)), start, couple);
  const before = rel.status;

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
    kindness: (b.personality.kindness + c.personality.kindness) / 2,
    taken: takenBy(world, b, c),
    energy: (b.vitals.energy + c.vitals.energy) / 2,
    found: b.last.activity === "discover" || c.last.activity === "discover",
    ...sky,
  };
  const kind = together && joinsIn(together, rel.status) ? together : pickInteraction(ctx, rng);
  const outcome = rollOutcome(ctx, rng);
  let delta = deltaFor(kind, outcome, ctx, rng);
  if (together) delta = { friendship: delta.friendship * CROWD, romance: delta.romance * CROWD, tension: delta.tension * CROWD };
  rel = applyDelta(rel, delta, end, couple);
  out.meetings.push({ id: crypto.randomUUID(), a: rel.a, b: rel.b, kind, outcome, start, end, rng: randomSeed(rng), delta });
  if (rel.status === "best_friends" && before !== "best_friends") rel = { ...rel, status: makeRoom(world, [b, c], rel, touched) };
  if (kind === "flirt" && outcome === "good") for (const x of [b, c]) jealous(world, x, touched);

  const loyalty = (b.personality.loyalty + c.personality.loyalty) / 2;
  if (world.visit) {
    // Nothing changes between them for good while away from the garden.
  } else if (couple && readyToBreakUp(rel, loyalty)) {
    union.endedAt = end;
    out.unionsEnded.push(union);
    rel = { ...rel, ex: true, romance: Math.max(0, rel.romance - 20) };
    rel = { ...rel, status: relationStatus(rel, false) };
  } else if (!couple && ctx.canRomance && readyForUnion(rel, ctx.romance, loyalty) && !union && !activeUnion(world, c.seed)) {
    const started: Union = { id: crypto.randomUUID(), a: rel.a, b: rel.b, startedAt: end, endedAt: null, lastBirthAt: null };
    world.unions.push(started);
    out.unionsStarted.push(started);
    rel = { ...rel, status: relationStatus(rel, true) };
    both("couple");
  }
  if (rel.status !== before) {
    if ((before === "strangers" || before === "acquaintances") && rel.status !== "acquaintances" && WARM.includes(rel.status)) both("friends", "");
    if (rel.status === "best_friends" || rel.status === "crush") both(rel.status);
    if ((before === "rivals" || before === "complicated" || before === "ex") && WARM.includes(rel.status)) both("made_up");
  }
  if (outcome === "good" && FIRSTS.includes(kind)) both("first", kind);
  world.relationships.set(key, rel);
  touched.set(key, rel);
  return { kind, outcome, status: rel.status };
}

/** Whether either of them is with someone else, and if so how loyal the
 * more loyal of those is. */
function takenBy(world: World, b: WorldBlob, c: WorldBlob): number | null {
  let taken: number | null = null;
  for (const [x, other] of [[b, c], [c, b]] as const) {
    const u = activeUnion(world, x.seed);
    if (u && u.a !== other.seed && u.b !== other.seed) taken = Math.max(taken ?? 0, x.personality.loyalty);
  }
  return taken;
}

/** `x` flirted with someone other than its sweetheart, and word gets around
 * a garden: the more loyal the sweetheart, the more it stings. */
function jealous(world: World, x: WorldBlob, touched: Map<string, Relationship>) {
  const union = activeUnion(world, x.seed);
  if (!union) return;
  const partner = world.blobs.get(union.a === x.seed ? union.b : union.a);
  const key = pairKey(union.a, union.b);
  const rel = world.relationships.get(key);
  if (!partner || !rel) return;
  const hurt = partner.personality.loyalty;
  const next = { ...rel, tension: Math.min(100, rel.tension + 1 + 3 * hurt) };
  world.relationships.set(key, next);
  touched.set(key, next);
}

// How many best friends a blob keeps: one, or two for a very sociable one.
const bestFriendsMax = (x: WorldBlob) => (x.personality.sociability > 0.7 ? 2 : 1);

/**
 * `rel` just grew into best friends. Each of the pair has only so much room:
 * if one is full, the new friendship takes the place of its weakest best
 * friendship (which goes back to friends) only if it's already the stronger
 * one; otherwise it stays plain friends for now. Returns `rel`'s status.
 */
function makeRoom(world: World, pair: WorldBlob[], rel: Relationship, touched: Map<string, Relationship>): RelationStatus {
  const out: Relationship[] = [];
  for (const x of pair) {
    const mine = [...world.relationships.values()].filter((r) => r.status === "best_friends" && (r.a === x.seed || r.b === x.seed) && !(r.a === rel.a && r.b === rel.b));
    if (mine.length < bestFriendsMax(x)) continue;
    const weakest = mine.reduce((w, r) => (r.friendship < w.friendship ? r : w));
    if (weakest.friendship >= rel.friendship) return "friends";
    out.push(weakest);
  }
  for (const r of out) {
    const next = { ...r, status: "friends" as const };
    world.relationships.set(pairKey(r.a, r.b), next);
    touched.set(pairKey(r.a, r.b), next);
  }
  return "best_friends";
}

/** A couple alone together, having a lovely time, may have a child. */
function maybeBorn(
  world: World,
  b: WorldBlob,
  c: WorldBlob,
  kind: InteractionKind,
  outcome: Outcome,
  where: { x: number; y: number },
  at: number,
  rng: Rng,
  out: WorldStep,
  touched: Map<string, Relationship>,
) {
  const union = activeUnion(world, b.seed);
  if (world.visit) return;
  // Not in the very meeting they got together in.
  if (!union || (union.a !== c.seed && union.b !== c.seed) || union.startedAt >= at) return;
  if (outcome !== "good" || (kind !== "hug" && kind !== "kiss" && kind !== "dance")) return;
  const room = Math.max(0, 1 - world.blobs.size / POPULATION_CAP);
  const rested = union.lastBirthAt === null || at - union.lastBirthAt >= BIRTH_COOLDOWN;
  if (rested && rng() < 0.05 * room) born(world, union, b, c, where, at, rng, out, touched);
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
  for (const [p, other] of [[b, c], [c, b]] as const) out.milestones.push({ seed: p.seed, kind: "child", key: child.seed, with: [other.seed, child.seed], at });
}
