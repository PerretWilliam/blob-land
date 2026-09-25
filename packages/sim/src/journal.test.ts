import { describe, expect, it } from "vitest";
import { activityLog, journal } from "./journal";
import { activityChanges, stateAt } from "./state";
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

  it("logs every activity change of a day, each matching stateAt", () => {
    const from = dayStart("2026-09-01");
    const to = dayStart("2026-09-02");
    const changes = activityChanges("alice", from, to);
    for (const c of ["sleep", "rest", "explore"]) expect(changes.some((x) => x.activity === c)).toBe(true);
    for (const c of changes) expect(stateAt("alice", c.at).activity).toBe(c.activity);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.at).toBeGreaterThan(changes[i - 1]!.at);
    expect(activityLog("alice", from, to).map((e) => e.at)).toEqual(changes.map((c) => c.at));
  });
});
