import { describe, expect, it } from "vitest";
import { addDays, dayKey, dayStart } from "./time";

describe("time (UTC-only, v1)", () => {
  it("round-trips dayStart <-> dayKey", () => {
    expect(dayKey(dayStart("2026-09-25"))).toBe("2026-09-25");
  });

  it("keys the last instant of a day to that day, not the next", () => {
    const justBeforeMidnight = dayStart("2026-09-26") - 1;
    expect(dayKey(justBeforeMidnight)).toBe("2026-09-25");
  });

  it("addDays crosses month/year boundaries in UTC", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  // No local-timezone DST handling is expected: v1 is UTC-only (plan decision
  // #4), so a UTC day is always exactly 24h regardless of what any local
  // clock is doing on a DST-transition date.
  it("is unaffected by DST transition dates (US: 2026-03-08, EU: 2026-03-29)", () => {
    expect(dayStart("2026-03-09") - dayStart("2026-03-08")).toBe(24 * 60 * 60 * 1000);
    expect(dayStart("2026-03-30") - dayStart("2026-03-29")).toBe(24 * 60 * 60 * 1000);
  });
});
