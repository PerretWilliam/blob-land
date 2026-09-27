import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, playerPseudo } from "./identity";
import { seededRng } from "./rng";

describe("playerPseudo", () => {
  it("makes short, varied pseudos", () => {
    const rng = seededRng(1);
    const pseudos = Array.from({ length: 500 }, () => playerPseudo(rng));
    expect(pseudos.every((p) => p.length > 0 && p.length <= MAX_NAME_LENGTH)).toBe(true);
    expect(new Set(pseudos).size).toBeGreaterThan(300);
  });
});
