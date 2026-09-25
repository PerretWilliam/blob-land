import { describe, expect, it } from "vitest";
import { loveChance } from "./love";

describe("loveChance", () => {
  it("is deterministic", () => {
    expect(loveChance("alice", "bob", "2026-09-25")).toBe(loveChance("alice", "bob", "2026-09-25"));
  });

  it("is symmetric in the pair", () => {
    expect(loveChance("alice", "bob", "2026-09-25")).toBe(loveChance("bob", "alice", "2026-09-25"));
  });

  it("varies by day", () => {
    expect(loveChance("alice", "bob", "2026-09-25")).not.toBe(loveChance("alice", "bob", "2026-09-26"));
  });

  it("stays in [0, 1)", () => {
    const v = loveChance("alice", "bob", "2026-09-25");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});
