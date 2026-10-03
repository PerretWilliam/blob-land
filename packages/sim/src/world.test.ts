import { describe, expect, it } from "vitest";
import { compatible, PERSONALITY_AXES, randomPersonality, type Identity, type Personality } from "./identity";
import { allowedFor, feeling, INTERACTIONS, joinsIn, MAX_STEP, moodShift, pickInteraction, type MeetingContext } from "./interactions";
import { DURATION, firstSegment, NEXT, nextSolo, SLEEP_HOURS, sleepPressure, type Segment } from "./life";
import { affinity, applyDelta, newRelationship, readyForUnion, readyToBreakUp, relationStatus, type RelationStatus, type Relationship } from "./relationship";
import { randomRng, seededRng, type Rng } from "./rng";
import { GROUP_MAX, stepWorld, type World, type WorldBlob } from "./world";

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
        // The first to arrive may wait up to 5 minutes for the others; groups linger longer.
        expect(length).toBeLessThanOrEqual(DURATION.meet[1] * 1.5 + 5 * 60 * 1000 + 1);
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
      const a = bySeed.get(m.a)!.find((s) => s.activity === "meet" && s.end === m.end && s.with?.includes(m.b));
      const b = bySeed.get(m.b)!.find((s) => s.activity === "meet" && s.end === m.end && s.with?.includes(m.a));
      expect(a && b).toBeTruthy();
    }
  });

  it("gathers groups now and then, standing close together", () => {
    const groups = step.segments.filter((s) => s.activity === "meet" && s.with!.length > 1);
    expect(groups.length).toBeGreaterThan(0);
    for (const s of groups) {
      expect(s.with!.length).toBeLessThan(GROUP_MAX);
      for (const other of s.with!) {
        const o = bySeed.get(other)!.find((x) => x.activity === "meet" && x.end === s.end)!;
        expect(o.with).toContain(s.seed);
        expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeLessThan(0.2);
      }
    }
  });

  it("leaves a blob cross after a fight", () => {
    for (const segs of bySeed.values()) {
      segs.forEach((s, i) => {
        const next = segs[i + 1];
        if (s.detail === "argue:bad" && next && (next.activity === "explore" || next.activity === "rest")) expect(next.expression).toBe("mad");
      });
    }
  });

  it("keeps night owls up and early birds in bed on their own clocks", () => {
    const evening = Date.UTC(2026, 8, 26, 22);
    const tired = { energy: 0.4, mood: 0 };
    expect(sleepPressure(tired, evening, 1)).toBeLessThan(sleepPressure(tired, evening, 0));
    // Both fall asleep at 22:00; the night owl sleeps in.
    const bed: Segment = { ...firstSegment(evening, seededRng(1)), activity: "explore" };
    const wakeAt = (chronotype: number) => {
      const rng = seededRng(3);
      let seg = bed;
      for (let i = 0; i < 50 && seg.activity !== "sleep"; i++) seg = nextSolo(seg, { energy: 0.1, mood: 0 }, rng, chronotype);
      return seg.end;
    };
    expect(wakeAt(1)).toBeGreaterThan(wakeAt(0) + 2 * HOUR);
  });

  it("carries a meeting's mood into what comes next, most of the time", () => {
    let [after, kept] = [0, 0];
    for (const segs of bySeed.values()) {
      segs.forEach((s, i) => {
        const next = segs[i + 1];
        if (s.activity !== "meet" || !next || (next.activity !== "explore" && next.activity !== "rest")) return;
        after++;
        if (next.expression === s.expression || (s.detail?.endsWith(":bad") && ["sad", "unsure", "mad"].includes(next.expression))) kept++;
      });
    }
    expect(kept / after).toBeGreaterThan(0.6);
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
    kindness: 0.5,
    taken: null,
    energy: 0.7,
    found: false,
    night: false,
    weather: "clear",
    season: "blossom",
    ...over,
  });

  it("shows on a blob's face, and in its mood, who it's with", () => {
    expect(feeling("chat", "good", "lovers")).toBe("love");
    expect(feeling("chat", "meh", "crush")).toBe("shy");
    expect(feeling("play", "good", "rivals")).toBe("unsure");
    expect(feeling("argue", "bad", "lovers")).toBe("mad");
    expect(feeling("play", "good", "friends")).toBe("happy");
    expect(moodShift("play", "good", "best_friends")).toBeGreaterThan(moodShift("play", "good", "acquaintances"));
    expect(moodShift("play", "good", "acquaintances")).toBeGreaterThan(0);
    expect(moodShift("chat", "good", "rivals")).toBe(0);
    expect(moodShift("chat", "bad")).toBeLessThan(0);
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
    for (let i = 0; i < 500; i++) expect(["flirt", "kiss", "confess"]).not.toContain(pickInteraction(ctx(rel, { canRomance: false }), rng));
    expect(INTERACTIONS).toContain("kiss");
  });

  it("comforts the low, confesses a deep crush, shares a find and naps only when it fits", () => {
    const rng = seededRng(3);
    const kinds = (status: RelationStatus, over: Partial<MeetingContext> = {}, extra: Partial<Relationship> = {}) => {
      const rel = { ...newRelationship("a", "b", seededRng(0)), status, ...extra };
      return new Set(Array.from({ length: 800 }, () => pickInteraction(ctx(rel, over), rng)));
    };
    expect(kinds("friends")).not.toContain("comfort");
    expect(kinds("friends", { moodA: -0.8, kindness: 1 })).toContain("comfort");
    expect(kinds("crush", {}, { romance: 20 })).not.toContain("confess");
    expect(kinds("crush", {}, { romance: 60 })).toContain("confess");
    expect(kinds("friends")).not.toContain("share_find");
    expect(kinds("friends", { found: true })).toContain("share_find");
    expect(kinds("lovers")).not.toContain("nap_together");
    expect(kinds("lovers", { energy: 0.1 })).toContain("nap_together");
    expect(feeling("nap_together", "good", "lovers")).toBe("sleepy");
    expect(moodShift("comfort", "good", "friends")).toBeGreaterThan(moodShift("chat", "good", "friends"));
    expect(kinds("lovers")).not.toContain("stargaze");
    expect(kinds("lovers", { night: true })).toContain("stargaze");
  });

  it("has weather moments only under their sky", () => {
    const rng = seededRng(5);
    const kinds = (status: RelationStatus, over: Partial<MeetingContext>) => {
      const rel = { ...newRelationship("a", "b", seededRng(0)), status };
      return new Set(Array.from({ length: 800 }, () => pickInteraction(ctx(rel, over), rng)));
    };
    const sunny = kinds("friends", { weather: "clear", season: "summer" });
    for (const k of ["shelter", "splash", "snowball", "snowman", "flowers", "leaf_pile", "fireflies"]) expect(sunny).not.toContain(k);
    expect(kinds("friends", { weather: "rain" })).toContain("shelter");
    expect(kinds("friends", { weather: "rain" })).toContain("splash");
    expect(kinds("friends", { weather: "snow", season: "snowfall" })).toContain("snowball");
    expect(kinds("family", { weather: "snow", season: "snowfall" })).toContain("snowman");
    expect(kinds("lovers", { weather: "clear", season: "blossom" })).toContain("flowers");
    expect(kinds("friends", { weather: "clear", season: "falling_leaves" })).toContain("leaf_pile");
    expect(kinds("lovers", { weather: "clear", season: "fireflies", night: true })).toContain("fireflies");
    expect(kinds("lovers", { weather: "clear", season: "fireflies", night: false })).not.toContain("fireflies");
    // No stars to look at through clouds; snowballs only once it's snowing.
    expect(kinds("lovers", { weather: "cloudy", night: true })).not.toContain("stargaze");
    expect(kinds("rivals", { weather: "snow", season: "snowfall" })).toContain("snowball");
    expect(kinds("rivals", { weather: "clear", season: "snowfall" })).not.toContain("snowball");
  });

  it("keeps group moments to groups, and lets only those who get on join in", () => {
    const rng = seededRng(4);
    const groupOnly = ["ring_dance", "story", "sing", "group_hug", "tag", "cheer"] as const;
    for (const status of ["friends", "lovers", "family", "strangers"] as const) {
      const rel = { ...newRelationship("a", "b", seededRng(0)), status };
      for (let i = 0; i < 500; i++) expect(groupOnly).not.toContain(pickInteraction(ctx(rel, { found: true, night: true }), rng));
    }
    expect(joinsIn("group_hug", "best_friends")).toBe(true);
    expect(joinsIn("group_hug", "strangers")).toBe(false);
    expect(joinsIn("ring_dance", "rivals")).toBe(false);
    expect(joinsIn("story", "ex")).toBe(true);
    expect(joinsIn("chat", "rivals")).toBe(false);
  });

  it("doesn't flicker between statuses at a threshold", () => {
    let rel: Relationship = { ...newRelationship("a", "b", seededRng(0)), friendship: 74, meetings: 5 };
    rel = { ...rel, status: relationStatus(rel, false) };
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      // Gains shrink as friendship grows (applyDelta), so +3/-1 hovers in place, just under best friends.
      rel = applyDelta(rel, { friendship: i % 2 ? 3 : -1, romance: 0, tension: 0 }, i, false);
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

const plain = (over: Partial<Personality> = {}): Personality => ({ ...Object.fromEntries(PERSONALITY_AXES.map((a) => [a, 0.5])), ...over }) as Personality;

describe("character and relationships", () => {
  it("fits average pairs at about zero, alike and kind ones better, hotheads worse", () => {
    const rng = seededRng(4);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += affinity(randomPersonality(rng), randomPersonality(rng));
    expect(Math.abs(sum / 4000)).toBeLessThan(0.03);
    const sweet = plain({ playfulness: 0.9, kindness: 0.9, temper: 0.1 });
    const hot = plain({ temper: 1, kindness: 0.1 });
    expect(affinity(sweet, sweet)).toBeGreaterThan(0.3);
    expect(affinity(hot, hot)).toBeLessThan(-0.3);
  });

  it("lets romantics fall sooner, and loyal couples hold on longer", () => {
    const rel = { ...newRelationship("a", "b", seededRng(0)), romance: 58, friendship: 40 };
    expect(readyForUnion(rel, 0.9, 0.5)).toBe(true);
    expect(readyForUnion(rel, 0.1, 0.5)).toBe(false);
    const rocky = { ...rel, romance: 45, tension: 65 };
    expect(readyToBreakUp(rocky, 0.1)).toBe(true);
    expect(readyToBreakUp(rocky, 0.9)).toBe(false);
  });

  it("keeps a loyal blob that's spoken for from flirting", () => {
    const rel = { ...newRelationship("a", "b", seededRng(0)), status: "crush" as const, romance: 50 };
    const rng = seededRng(5);
    const base: MeetingContext = { rel, canRomance: true, parentAndChild: false, moodA: 0.5, moodB: 0.5, temper: 0.5, playfulness: 0.5, romance: 1, kindness: 0.5, taken: 1, energy: 0.7, found: false, night: false, weather: "clear", season: "blossom" };
    for (let i = 0; i < 300; i++) expect(pickInteraction(base, rng)).not.toBe("flirt");
  });

  // a and c are about to become best friends; a already has one, b (not in
  // the world: it's elsewhere). a is middling sociable: room for one.
  function bestFriends(abFriendship: number) {
    const a = plain({ sociability: 1, kindness: 1, temper: 0 });
    const blob = (seed: string, personality: Personality): WorldBlob => ({
      seed, identity: { sex: "none", attraction: "women" }, personality, bornAt: T0, adultAt: T0, parents: null, traits: null, vitals: { energy: 0.9, mood: 0.8 }, last: firstSegment(T0, seededRng(1), { x: 0.5, y: 0.5 }),
    });
    const world: World = {
      blobs: new Map([["a", blob("a", { ...a, sociability: 0.6 })], ["c", blob("c", a)]]),
      relationships: new Map([
        ["a|b", { ...newRelationship("a", "b", seededRng(0)), friendship: abFriendship, status: "best_friends", meetings: 9, lastMetAt: T0 }],
        ["a|c", { ...newRelationship("a", "c", seededRng(0)), friendship: 95, chemistry: 1, status: "friends", meetings: 9, lastMetAt: T0 }],
      ]),
      unions: [],
    };
    const step = stepWorld(world, T0 + 2 * DAY, seededRng(6));
    expect(step.meetings.length).toBeGreaterThan(0);
    return [world.relationships.get("a|b")!.status, world.relationships.get("a|c")!.status];
  }

  it("makes room for a closer best friend, demoting the old one", () => {
    expect(bestFriends(70)).toEqual(["friends", "best_friends"]);
  });

  it("keeps the old best friend when the new one isn't closer yet", () => {
    expect(bestFriends(100)).toEqual(["best_friends", "friends"]);
  });
});
