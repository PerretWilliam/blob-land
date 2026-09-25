import { describe, expect, it } from "vitest";
import { stateAt } from "./state";
import { dayStart } from "./time";

const SEED = "alice";
const DAY = "2026-09-25";

describe("stateAt", () => {
  it("is deterministic for the same seed and instant", () => {
    const t = dayStart(DAY) + 12 * 60 * 60 * 1000;
    expect(stateAt(SEED, t)).toEqual(stateAt(SEED, t));
  });

  it("sleeps at night", () => {
    const midnight = dayStart(DAY) + 2 * 60 * 60 * 1000; // 02:00 UTC
    expect(stateAt(SEED, midnight).activity).toBe("sleep");
  });

  it("does not sleep at midday", () => {
    const noon = dayStart(DAY) + 12 * 60 * 60 * 1000; // clear of rest/sleep jitter
    expect(stateAt(SEED, noon).activity).not.toBe("sleep");
  });

  it("never leaves a blob sick or mad (no death/maintenance in this concept)", () => {
    for (let h = 0; h < 24; h++) {
      const activity = stateAt(SEED, dayStart(DAY) + h * 60 * 60 * 1000).activity;
      expect(["sleep", "rest", "explore", "discover"]).toContain(activity);
    }
  });

  it("holds `since` constant through a sleep segment, and it precedes `t`", () => {
    const midnight = dayStart(DAY) + 2 * 60 * 60 * 1000;
    const oneHourLater = midnight + 60 * 60 * 1000;
    const a = stateAt(SEED, midnight);
    const b = stateAt(SEED, oneHourLater);
    expect(a.activity).toBe("sleep");
    expect(b.activity).toBe("sleep");
    expect(a.since).toBe(b.since);
    expect(a.since).toBeLessThanOrEqual(midnight);
  });

  it("crosses the day boundary consistently (sleep spans midnight)", () => {
    const justBeforeMidnight = dayStart("2026-09-26") - 60 * 1000;
    const justAfterMidnight = dayStart("2026-09-26") + 60 * 1000;
    expect(stateAt(SEED, justBeforeMidnight).activity).toBe("sleep");
    expect(stateAt(SEED, justAfterMidnight).activity).toBe("sleep");
  });
});
