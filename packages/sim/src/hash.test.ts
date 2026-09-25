import { describe, expect, it } from "vitest";
import { hash01 } from "./hash";

describe("hash01", () => {
  it("is deterministic for the same key", () => {
    expect(hash01("alice|2026-09-25")).toBe(hash01("alice|2026-09-25"));
  });

  it("differs across keys", () => {
    expect(hash01("alice")).not.toBe(hash01("bob"));
  });

  it("stays in [0, 1)", () => {
    for (const key of ["a", "b", "seed|2026-01-01", ""]) {
      const v = hash01(key);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
