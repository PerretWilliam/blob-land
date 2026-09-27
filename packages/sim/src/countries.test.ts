import { describe, expect, it } from "vitest";
import { COUNTRIES, flagOf, isCountry } from "./countries";

describe("countries", () => {
  it("lists every ISO 3166-1 alpha-2 code once", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES).size).toBe(249);
  });

  it("accepts only listed codes", () => {
    expect(isCountry("FR")).toBe(true);
    expect(isCountry("fr")).toBe(false);
    expect(isCountry("ZZ")).toBe(false);
    expect(isCountry(null)).toBe(false);
  });

  it("spells a flag with regional indicators", () => {
    expect(flagOf("FR")).toBe("\u{1F1EB}\u{1F1F7}");
  });
});
