import {
  between,
  firstSegment,
  pairKey,
  personalityOf,
  randomPersonality,
  randomRng,
  stepWorld,
  type Gait,
  type Identity,
  type Personality,
  type Relationship,
  type Rng,
  type Segment,
  type Spell,
  type Vitals,
  type World,
  type WorldBlob,
} from "@blob-land/sim";
import type { Milestone, Visitor } from "@/lib/api";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Lived this far ahead, so the scene always has the next bit to play.
const LOOKAHEAD = 30 * MIN;
// Kept for the journal; older segments are dropped.
const KEEP = 3 * DAY;
// Closed for longer than this, the blob skips the gap instead of living it all.
const MAX_CATCH_UP = 7 * DAY;
const HOUR = 60 * MIN;

/** A player's blob staying on the island for a while, lived here alongside the private blob. */
export interface Guest {
  seed: string;
  name: string;
  identity: Identity;
  personality: Personality;
  gait?: Gait;
  vitals: Vitals;
  segments: Segment[];
  /** When it goes home. */
  until: number;
  /** A couple in the garden: still one here. */
  partner: boolean;
}

/** Everything the private blob is, on this device: who it is, how it feels,
 * and what it's been doing — rolled at random, stored, played back. */
export interface LocalLife {
  identity: Identity;
  personality: Personality;
  /** Picked by the player; unset, it walks as its character does. */
  gait?: Gait;
  vitals: Vitals;
  /** Sorted by start, running a little ahead of now. */
  segments: Segment[];
  /** The island's own sky, rolled on with its life (unset before weather existed). */
  weather?: Spell[];
  /** Who's visiting, if anyone. */
  guest?: Guest;
  /** Everyone who has visited, by seed: their name, and how they got on here. */
  met?: Record<string, { name: string; relationship: Relationship }>;
  /** Big moments lived here with visitors, the first time each: the island's page of the album. */
  album?: Milestone[];
}

export function newLife(identity: Identity, now: number): LocalLife {
  return { identity, personality: randomPersonality(randomRng), vitals: { energy: 0.9, mood: 0.15 }, segments: [firstSegment(now, randomRng)] };
}

/**
 * How long a visit lasts, rolled on arrival: a few hours between strangers,
 * up to two days between those who are close.
 */
export function stayFor(rel: Pick<Relationship, "friendship" | "romance"> | null, rng: Rng): number {
  const close = Math.max(rel?.friendship ?? 0, rel?.romance ?? 0) / 100;
  return between(rng, 3, 12) * HOUR + close * between(rng, 0, 36) * HOUR;
}

/** When the guest is gone: at the end of its stay, or of the moment it's sharing then. */
export const leavesAt = (guest: Guest) => Math.max(guest.until, ...guest.segments.filter((s) => s.activity === "meet").map((s) => s.end));

// What's been lived ahead of now is dropped, so an arrival or a goodbye shows at once.
const upTo = (segments: Segment[], now: number) => segments.filter((s) => s.start <= now);

/** `visitor` comes to stay: they pick up where they left off, here or in the garden, whichever is more recent. */
export function welcome(seed: string, life: LocalLife, visitor: Visitor, now: number, rng: Rng = randomRng): LocalLife {
  const [a, b] = [seed, visitor.seed].sort() as [string, string];
  const here = life.met?.[visitor.seed]?.relationship;
  const there = visitor.relationship && { ...visitor.relationship, a, b };
  const relationship = here && there ? ((here.lastMetAt ?? 0) >= (there.lastMetAt ?? 0) ? here : there) : (here ?? there ?? undefined);
  const guest: Guest = {
    seed: visitor.seed,
    name: visitor.name,
    identity: { sex: visitor.sex, attraction: visitor.attraction },
    personality: personalityOf(visitor.personality, visitor.seed),
    gait: visitor.gait ?? undefined,
    vitals: visitor.vitals,
    segments: [firstSegment(now, rng)],
    until: now + stayFor(relationship ?? null, rng),
    partner: visitor.partner,
  };
  const met = relationship ? { ...life.met, [visitor.seed]: { name: visitor.name, relationship } } : life.met;
  return { ...life, guest, met, segments: upTo(life.segments, now) };
}

/** The visitor goes home now. */
export const farewell = (life: LocalLife, now: number): LocalLife => ({ ...life, guest: undefined, segments: upTo(life.segments, now) });

/**
 * Lives the private blob forward to just past `now`: with its visitor while
 * one stays (a visit: what happens between them stays on the island), then
 * alone. Returns the updated life and the newly lived segments, oldest first.
 */
export function advanceLife(seed: string, life: LocalLife, now: number): { life: LocalLife; lived: Segment[] } {
  const until = now + LOOKAHEAD;
  const blob: WorldBlob = {
    seed,
    identity: life.identity,
    // Stored before some axes existed, maybe: fill them in.
    personality: personalityOf(life.personality, seed),
    bornAt: 0,
    adultAt: 0,
    parents: null,
    traits: null,
    vitals: life.vitals,
    last: life.segments[life.segments.length - 1] ?? firstSegment(now, randomRng),
  };
  const lived: Segment[] = [];
  let { weather, guest, met, album } = life;

  if (guest && blob.last.end < guest.until) {
    const g: WorldBlob = { ...blob, seed: guest.seed, identity: guest.identity, personality: guest.personality, vitals: guest.vitals, last: guest.segments[guest.segments.length - 1]! };
    const key = pairKey(seed, guest.seed);
    const [a, b] = key.split("|") as [string, string];
    const rel = met?.[guest.seed]?.relationship;
    const world: World = {
      blobs: new Map([[seed, blob], [guest.seed, g]]),
      relationships: new Map(rel ? [[key, rel]] : []),
      unions: guest.partner ? [{ id: "visit", a, b, startedAt: 0, endedAt: null, lastBirthAt: null }] : [],
      weather,
      visit: true,
    };
    const step = stepWorld(world, Math.min(until, guest.until), randomRng, MAX_CATCH_UP);
    const theirs = [...guest.segments];
    for (const { seed: who, ...segment } of step.segments) (who === seed ? lived : theirs).push(segment);
    weather = world.weather;
    guest = { ...guest, vitals: g.vitals, segments: theirs.filter((s) => s.end > now - KEEP) };
    const after = world.relationships.get(key);
    if (after) met = { ...met, [guest.seed]: { name: guest.name, relationship: after } };
    // Each kept the first time, as the garden's album does.
    const kept = new Set((album ?? []).map((m) => `${m.kind}|${m.key}`));
    for (const m of step.milestones) {
      if (m.seed !== seed || kept.has(`${m.kind}|${m.key}`)) continue;
      kept.add(`${m.kind}|${m.key}`);
      album = [...(album ?? []), { kind: m.kind, key: m.key, at: m.at, with: [{ seed: guest.seed, name: guest.name }] }];
    }
  }
  if (blob.last.end < until) {
    const world = { blobs: new Map([[seed, blob]]), relationships: new Map(), unions: [], weather };
    const step = stepWorld(world, until, randomRng, MAX_CATCH_UP);
    lived.push(...step.segments.map(({ seed: _, ...segment }) => segment));
    weather = world.weather;
  }
  // Its stay is over: home it goes.
  if (guest && leavesAt(guest) <= now) guest = undefined;

  const segments = [...life.segments, ...lived].filter((s) => s.end > now - KEEP);
  return { life: { ...life, personality: blob.personality, vitals: blob.vitals, segments, weather, guest, met, album }, lived };
}
