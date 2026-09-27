import { describe, expect, it } from "vitest";
import { daylight } from "./time";

describe("daylight", () => {
  it("is day at noon and night at 02:00 UTC", () => {
    expect(daylight(Date.UTC(2026, 8, 25, 12))).toBe(1);
    expect(daylight(Date.UTC(2026, 8, 25, 2))).toBe(0);
  });

  it("eases through dawn and dusk instead of snapping", () => {
    expect(daylight(Date.UTC(2026, 8, 25, 6))).toBeCloseTo(0.5);
    expect(daylight(Date.UTC(2026, 8, 25, 21))).toBeCloseTo(0.5);
  });
});
