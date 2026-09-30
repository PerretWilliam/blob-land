import type { Segment } from "./life";

/**
 * What the blob did, oldest first: the segments of its stored timeline worth
 * a line in the journal you scroll back through (the app words them, in the
 * player's language). Back-to-back explores read as one outing.
 */
export function activityLog(segments: readonly Segment[]): Segment[] {
  // A new blob's zero-length starting point isn't something it did.
  return segments.filter((seg, i) => seg.end !== seg.start && !(seg.activity === "explore" && segments[i - 1]?.activity === "explore"));
}

/** The bits worth a notification: waking up, finding things, meeting someone. */
export const notable = (segments: readonly Segment[]) =>
  activityLog(segments.filter((s) => s.activity === "wake" || s.activity === "discover" || s.activity === "meet"));
