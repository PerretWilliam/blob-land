import { describe, expect, it } from "vitest";
import { seededRng } from "./rng";
import { childTraits, type Parent } from "./traits";

const alice: Parent = { seed: "alice", traits: null };
const bob: Parent = { seed: "bob", traits: null };

describe("childTraits", () => {
  it("replays the same child from the same rng", () => {
    expect(childTraits(alice, bob, seededRng(1))).toEqual(childTraits(alice, bob, seededRng(1)));
  });

  it("gives siblings different looks", () => {
    expect(childTraits(alice, bob, seededRng(1))).not.toEqual(childTraits(alice, bob, seededRng(2)));
  });

  it("mixes a parent's stored traits, not its seed", () => {
    const childParent: Parent = { seed: "shared-seed", traits: { shape: 0.05, hue: 0.9 } };
    const seedOnlyParent: Parent = { seed: "shared-seed", traits: null };
    expect(childTraits(childParent, bob, seededRng(3))).not.toEqual(childTraits(seedOnlyParent, bob, seededRng(3)));
  });

  it("picks categorical keys whole from one parent, never blended", () => {
    const own = (p: Parent) => childTraits(p, p, seededRng(9))["shape"];
    for (let s = 0; s < 20; s++) expect([own(alice), own(bob)]).toContain(childTraits(alice, bob, seededRng(s))["shape"]);
  });

  it("lerps continuous keys between both parents' values", () => {
    const [a, b] = [childTraits(alice, alice, seededRng(0))["hue"]!, childTraits(bob, bob, seededRng(0))["hue"]!];
    for (let s = 0; s < 20; s++) {
      const hue = childTraits(alice, bob, seededRng(s))["hue"]!;
      expect(hue).toBeGreaterThanOrEqual(Math.min(a, b));
      expect(hue).toBeLessThanOrEqual(Math.max(a, b));
    }
  });
});
