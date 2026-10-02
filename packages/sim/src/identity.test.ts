import { describe, expect, it } from "vitest";
import { character, childPersonality, gaitOf, MAX_NAME_LENGTH, PERSONALITY_AXES, personalityOf, playerPseudo, randomPersonality, type Personality } from "./identity";
import { seededRng } from "./rng";

describe("playerPseudo", () => {
  it("makes short, varied pseudos", () => {
    const rng = seededRng(1);
    const pseudos = Array.from({ length: 500 }, () => playerPseudo(rng));
    expect(pseudos.every((p) => p.length > 0 && p.length <= MAX_NAME_LENGTH)).toBe(true);
    expect(new Set(pseudos).size).toBeGreaterThan(300);
  });
});

const flat = (over: Partial<Personality> = {}): Personality => ({ ...Object.fromEntries(PERSONALITY_AXES.map((a) => [a, 0.5])), ...over }) as Personality;

describe("personalityOf", () => {
  it("keeps every valid axis as is", () => {
    const p = randomPersonality(seededRng(3));
    expect(personalityOf(p, "a")).toEqual(p);
  });

  it("fills a missing or invalid axis the same way every time, per seed", () => {
    const old = { sociability: 0.2, temper: 0.9, playfulness: 0.4, romance: 0.7, chronotype: 0.5, kindness: 7 };
    const p = personalityOf(old, "mochi");
    expect(p).toMatchObject({ sociability: 0.2, temper: 0.9 });
    for (const axis of PERSONALITY_AXES) expect(p[axis]).toBeGreaterThanOrEqual(0), expect(p[axis]).toBeLessThanOrEqual(1);
    expect(personalityOf(old, "mochi")).toEqual(p);
    expect(personalityOf(old, "nova").loyalty).not.toBe(p.loyalty);
    expect(Object.keys(personalityOf(null, "x")).sort()).toEqual([...PERSONALITY_AXES].sort());
  });
});

describe("character", () => {
  it("reads the most marked axes, leaving out the habit of sleep", () => {
    expect(character(flat({ romance: 0.95, temper: 0.2, chronotype: 1 }))).toEqual({ main: "romance+", second: "temper-" });
    expect(character(flat({ kindness: 0.1 }))).toEqual({ main: "kindness-", second: null });
    expect(character(flat({ chronotype: 0 }))).toEqual({ main: null, second: null });
  });
});

describe("childPersonality", () => {
  it("mixes every axis", () => {
    const child = childPersonality(flat({ loyalty: 0 }), flat({ loyalty: 0 }), seededRng(2));
    expect(Object.keys(child).sort()).toEqual([...PERSONALITY_AXES].sort());
    expect(child.loyalty).toBeLessThanOrEqual(0.15);
  });
});

describe("gaitOf", () => {
  it("walks the way the strongest trait does, and strolls when none stands out", () => {
    expect(gaitOf(flat())).toBe("stroll");
    expect(gaitOf(flat({ playfulness: 0.9 }))).toBe("bouncy");
    expect(gaitOf(flat({ temper: 0.9, playfulness: 0.8 }))).toBe("stomp");
    expect(gaitOf(flat({ sociability: 0.1 }))).toBe("shy");
    expect(gaitOf(flat({ sociability: 0.9, kindness: 0.2 }))).toBe("proud");
  });

  it("leaves plenty of blobs strolling", () => {
    const rng = seededRng(3);
    const gaits = Array.from({ length: 1000 }, () => gaitOf(randomPersonality(rng)));
    const strolling = gaits.filter((g) => g === "stroll").length;
    expect(strolling).toBeGreaterThan(200);
    expect(new Set(gaits).size).toBe(5);
  });
});
