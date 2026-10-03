import { firstSegment, personalityOf, randomPersonality, randomRng, stepWorld, type Gait, type Identity, type Personality, type Segment, type Spell, type Vitals } from "@blob-land/sim";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Lived this far ahead, so the scene always has the next bit to play.
const LOOKAHEAD = 30 * MIN;
// Kept for the journal; older segments are dropped.
const KEEP = 3 * DAY;
// Closed for longer than this, the blob skips the gap instead of living it all.
const MAX_CATCH_UP = 7 * DAY;

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
}

export function newLife(identity: Identity, now: number): LocalLife {
  return { identity, personality: randomPersonality(randomRng), vitals: { energy: 0.9, mood: 0.15 }, segments: [firstSegment(now, randomRng)] };
}

/**
 * Lives the private blob forward to just past `now` — alone: it has no one
 * on this island to meet. Returns the updated life and the newly lived
 * segments, oldest first.
 */
export function advanceLife(seed: string, life: LocalLife, now: number): { life: LocalLife; lived: Segment[] } {
  const blob = {
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
  const world = { blobs: new Map([[seed, blob]]), relationships: new Map(), unions: [], weather: life.weather };
  const step = stepWorld(world, now + LOOKAHEAD, randomRng, MAX_CATCH_UP);
  const lived = step.segments.map(({ seed: _, ...segment }) => segment);
  const segments = [...life.segments, ...lived].filter((s) => s.end > now - KEEP);
  return { life: { ...life, personality: blob.personality, vitals: blob.vitals, segments, weather: world.weather }, lived };
}
