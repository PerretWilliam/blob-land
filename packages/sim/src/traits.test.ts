import { describe, expect, it } from "vitest";
import { childTraits, type Parent } from "./traits";

const alice: Parent = { seed: "alice", traits: null };
const bob: Parent = { seed: "bob", traits: null };

describe("childTraits", () => {
  it("is deterministic and frozen: same inputs always produce the same result", () => {
    expect(childTraits(alice, bob, "child-1")).toEqual(childTraits(alice, bob, "child-1"));
  });

  it("varies with the child seed (siblings aren't clones)", () => {
    expect(childTraits(alice, bob, "child-1")).not.toEqual(childTraits(alice, bob, "child-2"));
  });

  it("never recomputes from a seed for a parent that already has stored traits", () => {
    // A child-parent's stored traits are the source of truth, not its seed —
    // two different "effective" trait sets under the same seed must mix
    // differently.
    const childParent: Parent = { seed: "shared-seed", traits: { shape: 0.05, hue: 0.9 } };
    const seedOnlyParent: Parent = { seed: "shared-seed", traits: null };
    expect(childTraits(childParent, bob, "grandchild")).not.toEqual(
      childTraits(seedOnlyParent, bob, "grandchild"),
    );
  });

  it("picks categorical keys whole from one parent, never blended", () => {
    const a = childTraits(alice, bob, "x");
    // Re-derive what each parent's own value was for a categorical key and
    // confirm the child landed on exactly one of them.
    const aOnly = childTraits(alice, alice, "probe-a")["shape"];
    const bOnly = childTraits(bob, bob, "probe-b")["shape"];
    expect([aOnly, bOnly]).toContain(a["shape"]);
  });

  it("lerps continuous keys between both parents' values (inclusive)", () => {
    const a = childTraits(alice, alice, "probe-a")["hue"]!;
    const b = childTraits(bob, bob, "probe-b")["hue"]!;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (const childSeed of ["c1", "c2", "c3", "c4", "c5"]) {
      const value = childTraits(alice, bob, childSeed)["hue"]!;
      expect(value).toBeGreaterThanOrEqual(lo);
      expect(value).toBeLessThanOrEqual(hi);
    }
  });
});
