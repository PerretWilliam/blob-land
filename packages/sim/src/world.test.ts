import { describe, expect, it } from "vitest";
import { compatible, randomPersonality, type Identity } from "./identity";
import { allowedFor, INTERACTIONS, MAX_STEP, pickInteraction, type MeetingContext } from "./interactions";
import { DURATION, firstSegment, NEXT, SLEEP_HOURS, type Segment } from "./life";
import { applyDelta, newRelationship, relationStatus, type Relationship } from "./relationship";
import { randomRng, seededRng, type Rng } from "./rng";
import { stepWorld, type World, type WorldBlob } from "./world";

const T0 = Date.UTC(2026, 8, 25, 8);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function garden(n: number, rng: Rng, identity: (i: number) => Identity = (i) => ({ sex: i % 2 ? "male" : "female", attraction: "any" })): World {
  const blobs = new Map<string, WorldBlob>();
  for (let i = 0; i < n; i++) {
    const seed = `blob${i}`;
    blobs.set(seed, {
      seed,
      identity: identity(i),
      personality: randomPersonality(rng),
      bornAt: T0,
      adultAt: T0,
      parents: null,
      traits: null,
      vitals: { energy: 0.9, mood: 0.1 },
      last: firstSegment(T0, rng),
    });
  }
  return { blobs, relationships: new Map(), unions: [] };
}

describe("stepWorld", () => {
  // One long, truly random run, checked for everything that must never happen.
  const world = garden(12, randomRng);
  const step = stepWorld(world, T0 + 20 * DAY, randomRng, 30 * DAY);
  const bySeed = new Map<string, Segment[]>();
  for (const s of step.segments) bySeed.set(s.seed, [...(bySeed.get(s.seed) ?? []), s]);

  it("reaches the horizon for every blob", () => {
    for (const blob of world.blobs.values()) expect(blob.last.end).toBeGreaterThanOrEqual(T0 + 20 * DAY);
  });

  it("chains every timeline with no gaps and only allowed transitions", () => {
    for (const segs of bySeed.values()) {
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]!.start).toBe(segs[i - 1]!.end);
        expect(NEXT[segs[i - 1]!.activity]).toContain(segs[i]!.activity);
      }
    }
  });

  it("keeps durations sane: no blink-long naps, no endless walks", () => {
    for (const s of step.segments) {
      const length = s.end - s.start;
      if (s.activity === "sleep") {
        expect(length).toBeGreaterThanOrEqual(SLEEP_HOURS[0] * HOUR - 1);
        expect(length).toBeLessThanOrEqual(SLEEP_HOURS[1] * HOUR + 1);
      } else if (s.activity === "meet") {
        // The first to arrive may wait up to 5 minutes for the other.
        expect(length).toBeLessThanOrEqual(DURATION.meet[1] + 5 * 60 * 1000 + 1);
      } else {
        expect(length).toBeGreaterThanOrEqual(DURATION[s.activity][0] - 1);
        expect(length).toBeLessThanOrEqual(DURATION[s.activity][1] + 1);
      }
    }
  });

  it("sleeps every day, mostly at night", () => {
    for (const [seed, segs] of bySeed) {
      // Children born along the way have had fewer nights.
      const days = (T0 + 20 * DAY - world.blobs.get(seed)!.bornAt) / DAY;
      if (days < 3) continue;
      const sleeps = segs.filter((s) => s.activity === "sleep");
      expect(sleeps.length).toBeGreaterThanOrEqual(Math.floor(days * 0.8));
      const atNight = sleeps.filter((s) => {
        const h = new Date(s.start + (s.end - s.start) / 2).getUTCHours();
        return h >= 21 || h < 9;
      });
      expect(atNight.length / sleeps.length).toBeGreaterThan(0.7);
    }
  });

  it("pairs meetings up: both sides, same end, facing each other", () => {
    expect(step.meetings.length).toBeGreaterThan(50);
    for (const m of step.meetings) {
      const a = bySeed.get(m.a)!.find((s) => s.activity === "meet" && s.end === m.end && s.with === m.b);
      const b = bySeed.get(m.b)!.find((s) => s.activity === "meet" && s.end === m.end && s.with === m.a);
      expect(a && b).toBeTruthy();
    }
  });

  it("never lets an axis move more than a step per meeting", () => {
    for (const m of step.meetings) for (const v of Object.values(m.delta)) expect(Math.abs(v)).toBeLessThanOrEqual(MAX_STEP);
  });

  it("only ever unites mutually attracted, unrelated adults, one union each", () => {
    for (const u of step.unionsStarted) {
      const [a, b] = [world.blobs.get(u.a)!, world.blobs.get(u.b)!];
      expect(compatible(a.identity, b.identity)).toBe(true);
      expect(world.relationships.get(`${u.a}|${u.b}`)?.kin ?? null).toBeNull();
      expect(u.startedAt).toBeGreaterThanOrEqual(Math.max(a.adultAt, b.adultAt));
    }
    for (const seed of world.blobs.keys()) {
      expect(world.unions.filter((u) => u.endedAt === null && (u.a === seed || u.b === seed)).length).toBeLessThanOrEqual(1);
    }
  });

  it("gives newborns parents and family ties", () => {
    for (const { child } of step.births) {
      expect(child.parents).not.toBeNull();
      for (const p of child.parents!) expect(world.relationships.get([child.seed, p].sort().join("|"))?.kin).toBe("parent");
      expect(child.adultAt).toBeGreaterThan(child.bornAt);
    }
  });

  it("is never the same twice", () => {
    const again = stepWorld(garden(12, randomRng), T0 + 2 * DAY, randomRng);
    const first = stepWorld(garden(12, randomRng), T0 + 2 * DAY, randomRng);
    expect(again.segments.map((s) => s.activity).join()).not.toBe(first.segments.map((s) => s.activity).join());
  });

  it("keeps romance at zero between blobs who aren't into each other", () => {
    const rng = seededRng(42);
    // Everyone is a woman attracted to men: nobody is anybody's type.
    const w = garden(6, rng, () => ({ sex: "female", attraction: "men" }));
    stepWorld(w, T0 + 15 * DAY, rng, 30 * DAY);
    for (const rel of w.relationships.values()) expect(rel.romance).toBe(0);
    expect(w.unions).toHaveLength(0);
  });

  it("skips a gap longer than maxCatchUp instead of living through it", () => {
    const rng = seededRng(5);
    const w = garden(2, rng);
    const s = stepWorld(w, T0 + 30 * DAY, rng, DAY);
    expect(Math.min(...s.segments.map((x) => x.start))).toBeGreaterThanOrEqual(T0 + 29 * DAY);
  });
});

describe("relationships", () => {
  const ctx = (rel: Relationship, over: Partial<MeetingContext> = {}): MeetingContext => ({
    rel,
    canRomance: true,
    parentAndChild: false,
    moodA: 1,
    moodB: 1,
    temper: 0,
    playfulness: 1,
    romance: 1,
    ...over,
  });

  it("only picks what the relationship allows, however good the mood", () => {
    const rng = seededRng(1);
    for (const status of ["rivals", "ex", "complicated", "strangers"] as const) {
      const rel = { ...newRelationship("a", "b", seededRng(0)), status };
      for (let i = 0; i < 500; i++) expect(allowedFor(status)).toContain(pickInteraction(ctx(rel), rng));
    }
  });

  it("never lets rivals or exes hug, kiss or dance", () => {
    for (const status of ["rivals", "ex"] as const) for (const k of ["hug", "kiss", "dance", "play"]) expect(allowedFor(status)).not.toContain(k);
  });

  it("keeps flirting and kissing off the table without mutual attraction", () => {
    const rng = seededRng(2);
    const rel = { ...newRelationship("a", "b", seededRng(0)), status: "crush" as const };
    for (let i = 0; i < 500; i++) expect(["flirt", "kiss"]).not.toContain(pickInteraction(ctx(rel, { canRomance: false }), rng));
    expect(INTERACTIONS).toContain("kiss");
  });

  it("doesn't flicker between statuses at a threshold", () => {
    let rel: Relationship = { ...newRelationship("a", "b", seededRng(0)), friendship: 74, meetings: 5 };
    rel = { ...rel, status: relationStatus(rel, false) };
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      rel = applyDelta(rel, { friendship: i % 2 ? 2 : -2, romance: 0, tension: 0 }, i, false);
      seen.add(rel.status);
    }
    expect(seen.size).toBe(1);
  });

  it("reads family and couples off the facts, not the axes", () => {
    expect(relationStatus({ ...newRelationship("a", "b", seededRng(0), "parent"), tension: 90 }, false)).toBe("family");
    expect(relationStatus({ ...newRelationship("a", "b", seededRng(0)), tension: 90 }, true)).toBe("lovers");
  });

  it("only draws attraction the way each blob swings", () => {
    expect(compatible({ sex: "female", attraction: "men" }, { sex: "male", attraction: "women" })).toBe(true);
    expect(compatible({ sex: "female", attraction: "women" }, { sex: "female", attraction: "women" })).toBe(true);
    expect(compatible({ sex: "female", attraction: "men" }, { sex: "male", attraction: "men" })).toBe(false);
    expect(compatible({ sex: "none", attraction: "any" }, { sex: "male", attraction: "women" })).toBe(false);
    expect(compatible({ sex: "none", attraction: "any" }, { sex: "male", attraction: "any" })).toBe(true);
  });
});
