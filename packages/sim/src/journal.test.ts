import { describe, expect, it } from "vitest";
import { activityLog, notable } from "./journal";
import type { Segment } from "./life";

const seg = (start: number, activity: Segment["activity"], extra: Partial<Segment> = {}): Segment => ({
  start,
  end: start + 1,
  activity,
  expression: "idle",
  x: 0.5,
  y: 0.5,
  rng: 0,
  with: null,
  detail: null,
  ...extra,
});

describe("activityLog", () => {
  const segs = [
    seg(1, "sleep"),
    seg(2, "wake"),
    seg(3, "explore"),
    seg(4, "explore"),
    seg(5, "discover", { detail: "a smooth pebble" }),
    seg(6, "meet", { with: ["bob"], detail: "hug:good" }),
    seg(7, "meet", { with: ["ann", "bob", "cy"], detail: "chat:good" }),
  ];

  it("tells the day in order, merging back-to-back explores", () => {
    expect(activityLog(segs, (s) => s.toUpperCase()).map((e) => e.text)).toEqual([
      "Fell asleep.",
      "Woke up.",
      "Went exploring.",
      "Found a smooth pebble.",
      "Hugged BOB.",
      "Had a lovely chat with ANN, BOB and CY.",
    ]);
  });

  it("only notifies about wakes, finds and meetings", () => {
    expect(notable(segs).map((e) => e.at)).toEqual([2, 5, 6, 7]);
  });
});
