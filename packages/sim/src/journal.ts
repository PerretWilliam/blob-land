import { eventsOfDay } from "./events";
import { activityChanges, stateAt } from "./state";
import { addDays, dayKey } from "./time";

export interface JournalEntry {
  at: number;
  text: string;
}

const MAX_DAYS = 30;

/** Deterministic journal text for the events between two visits, capped at
 * the last ~30 days so a long-absent visitor doesn't get years of backlog. */
export function journal(seed: string, from: number, to: number): JournalEntry[] {
  if (to <= from) return [];

  const lastDay = dayKey(to);
  const earliestDay = addDays(lastDay, -(MAX_DAYS - 1));
  const firstDay = dayKey(from) < earliestDay ? earliestDay : dayKey(from);

  const entries: JournalEntry[] = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    for (const event of eventsOfDay(seed, day)) {
      if (event.at < from || event.at > to) continue;
      const text = event.type === "wake" ? "Woke up." : `Found ${event.detail}.`;
      entries.push({ at: event.at, text });
    }
  }
  return entries;
}

/** Everything the blob did in (from, to], oldest first — the journal you can
 * scroll back through, not just the notable bits `journal` notifies about. */
export function activityLog(seed: string, from: number, to: number): JournalEntry[] {
  const changes = activityChanges(seed, from, to);
  return changes.map(({ at, activity }, i) => {
    const before = i ? changes[i - 1]!.activity : stateAt(seed, from).activity;
    if (activity === "explore" && before === "sleep") return { at, text: "Woke up." };
    if (activity === "discover") {
      const found = eventsOfDay(seed, dayKey(at)).find((e) => e.type === "discover" && e.at === at);
      return { at, text: found ? `Found ${found.detail}.` : "Found something." };
    }
    return { at, text: { sleep: "Fell asleep.", rest: "Took a break.", explore: "Went exploring." }[activity] };
  });
}
