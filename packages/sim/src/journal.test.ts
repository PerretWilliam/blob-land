import { describe, expect, it } from "vitest";
import { journal } from "./journal";
import { dayStart } from "./time";

describe("journal", () => {
  it("is deterministic for the same seed and window", () => {
    const from = dayStart("2026-09-01");
    const to = dayStart("2026-09-10");
    expect(journal("alice", from, to)).toEqual(journal("alice", from, to));
  });

  it("only includes events inside [from, to]", () => {
    const from = dayStart("2026-09-01");
    const to = dayStart("2026-09-10");
    for (const entry of journal("alice", from, to)) {
      expect(entry.at).toBeGreaterThanOrEqual(from);
      expect(entry.at).toBeLessThanOrEqual(to);
    }
  });

  it("is empty for an empty or inverted window", () => {
    const t = dayStart("2026-09-01");
    expect(journal("alice", t, t)).toEqual([]);
    expect(journal("alice", t, t - 1)).toEqual([]);
  });

  it("caps backlog at ~30 days even for a long absence", () => {
    const from = dayStart("2020-01-01");
    const to = dayStart("2026-09-25");
    const entries = journal("alice", from, to);
    const earliestAllowed = dayStart("2026-08-27"); // 30 days back from `to`'s day
    for (const entry of entries) {
      expect(entry.at).toBeGreaterThanOrEqual(earliestAllowed);
    }
  });
});
