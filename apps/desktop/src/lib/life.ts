import { firstSegment, randomPersonality, randomRng, stepWorld, type Identity, type Personality, type Segment, type Vitals } from "@blob-land/sim";

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
  vitals: Vitals;
  /** Sorted by start, running a little ahead of now. */
  segments: Segment[];
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
    personality: life.personality,
    bornAt: 0,
    adultAt: 0,
    parents: null,
    traits: null,
    vitals: life.vitals,
    last: life.segments[life.segments.length - 1] ?? firstSegment(now, randomRng),
  };
  const step = stepWorld({ blobs: new Map([[seed, blob]]), relationships: new Map(), unions: [] }, now + LOOKAHEAD, randomRng, MAX_CATCH_UP);
  const lived = step.segments.map(({ seed: _, ...segment }) => segment);
  const segments = [...life.segments, ...lived].filter((s) => s.end > now - KEEP);
  return { life: { ...life, vitals: blob.vitals, segments }, lived };
}
