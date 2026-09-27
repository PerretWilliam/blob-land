import { interactionText, type InteractionKind, type Outcome } from "./interactions";
import type { Segment } from "./life";

export interface JournalEntry {
  at: number;
  text: string;
}

/**
 * What the blob did, oldest first, read off its stored segments — the
 * journal you scroll back through. `nameOf` turns a seed met into a name.
 * Back-to-back explores read as one outing.
 */
export function activityLog(segments: readonly Segment[], nameOf: (seed: string) => string = (s) => s): JournalEntry[] {
  const entries: JournalEntry[] = [];
  segments.forEach((seg, i) => {
    const before = segments[i - 1]?.activity;
    const at = seg.start;
    // A new blob's zero-length starting point isn't something it did.
    if (seg.end === seg.start) return;
    switch (seg.activity) {
      case "sleep":
        return entries.push({ at, text: "Fell asleep." });
      case "wake":
        return entries.push({ at, text: "Woke up." });
      case "rest":
        return entries.push({ at, text: "Took a break." });
      case "explore":
        return before === "explore" ? undefined : entries.push({ at, text: "Went exploring." });
      case "discover":
        return entries.push({ at, text: `Found ${seg.detail ?? "something"}.` });
      case "meet": {
        const [kind, outcome] = (seg.detail ?? "chat:meh").split(":") as [InteractionKind, Outcome];
        return entries.push({ at, text: interactionText(kind, outcome, seg.with?.length ? listNames(seg.with.map(nameOf)) : "someone") });
      }
    }
  });
  return entries;
}

/** "A", "A and B", "A, B and C". */
export const listNames = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The bits worth a notification: waking up, finding things, meeting someone. */
export const notable = (segments: readonly Segment[], nameOf?: (seed: string) => string) =>
  activityLog(
    segments.filter((s) => s.activity === "wake" || s.activity === "discover" || s.activity === "meet"),
    nameOf,
  );
