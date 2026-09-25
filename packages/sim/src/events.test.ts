import { describe, expect, it } from "vitest";
import { eventsOfDay } from "./events";
import { stateAt } from "./state";
import { dayStart } from "./time";

describe("eventsOfDay", () => {
  it("is deterministic for the same seed and day", () => {
    expect(eventsOfDay("alice", "2026-09-25")).toEqual(eventsOfDay("alice", "2026-09-25"));
  });

  it("differs across seeds", () => {
    const seeds = ["alice", "bob", "coralie", "dara", "elan"];
    const counts = seeds.map((s) => eventsOfDay(s, "2026-09-25").length);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it("produces exactly one wake plus 0-2 discoveries, within the day and chronologically sorted", () => {
    for (const seed of ["alice", "bob", "coralie", "dara", "elan", "finn"]) {
      const day = "2026-09-25";
      const events = eventsOfDay(seed, day);
      expect(events.filter((e) => e.type === "wake")).toHaveLength(1);
      expect(events.length).toBeLessThanOrEqual(3);
      for (const e of events) {
        expect(e.at).toBeGreaterThanOrEqual(dayStart(day));
        expect(e.at).toBeLessThan(dayStart(day) + 24 * 60 * 60 * 1000);
      }
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
      }
    }
  });

  it("wake is deterministic (not a probability) and matches stateAt's sleep->explore boundary", () => {
    const day = "2026-09-25";
    for (const seed of ["alice", "bob", "coralie"]) {
      const wake = eventsOfDay(seed, day).find((e) => e.type === "wake")!;
      expect(stateAt(seed, wake.at - 1).activity).toBe("sleep");
      expect(stateAt(seed, wake.at).activity).toBe("explore");
    }
  });
});
