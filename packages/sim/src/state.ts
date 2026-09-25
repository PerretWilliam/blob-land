import { eventsOfDay } from "./events";
import { hash01 } from "./hash";
import { sleepWindow } from "./sleep";
import { addDays, dayKey, dayStart, type Tz } from "./time";
// Expressions are objects a consumer imports, not strings (see blobatar's own
// docs) — passing a string here would not type-check against `Expression`.
import { happy, idle, sleepy, surprised, thinking, type Expression } from "blobatar/expression";

export type Activity = "sleep" | "rest" | "explore" | "discover";

export interface BlobState {
  activity: Activity;
  expression: Expression;
  /** Epoch ms when the current activity segment started. */
  since: number;
}

interface Segment {
  start: number;
  end: number;
  activity: Activity;
  expression: Expression;
}

const HOUR = 60 * 60 * 1000;

// No death/maintenance in this concept (see plan), so sleep/rest/explore is
// the full day — nothing here can leave a blob "sick" or "mad" by default.
function daySchedule(seed: string, day: string, exprAt: (key: string, options: readonly Expression[]) => Expression): Segment[] {
  const start = dayStart(day);
  const base = `${seed}|${day}`;

  const { start: sleepStart, end: sleepEnd } = sleepWindow(seed, day);

  // Rest: a single midday break, ~13:00, jittered +/-60min, 30-60min long.
  const restStart = start + 13 * HOUR + (hash01(`${base}|restStart`) * 2 - 1) * HOUR;
  const restLen = (0.5 + hash01(`${base}|restLen`) * 0.5) * HOUR;
  const restEnd = restStart + restLen;

  const exploreExpr = exprAt(`${base}|mood`, [idle, happy]);

  const segments: Segment[] = [
    { start, end: restStart, activity: "explore", expression: exploreExpr },
    { start: restStart, end: restEnd, activity: "rest", expression: idle },
    { start: restEnd, end: sleepStart, activity: "explore", expression: exploreExpr },
    { start: sleepStart, end: sleepEnd, activity: "sleep", expression: sleepy },
  ];

  const discoverEvents = eventsOfDay(seed, day).filter((event) => event.type === "discover");
  for (const [i, event] of discoverEvents.entries()) {
    const discoverExpr = exprAt(`${base}|discoverExpr${i}`, [surprised, thinking]);
    segments.push({ start: event.at, end: event.at + 20 * 60 * 1000, activity: "discover", expression: discoverExpr });
  }

  // Later entries win at a given instant, so discoveries (pushed last) take
  // priority over the explore/rest backdrop they interrupt.
  return segments;
}

/**
 * The blob's activity at time `t` (epoch ms), purely from `seed` and `t` — no
 * account/garden state. A `love` expression while paired up in the garden is
 * layered on top by the caller, since that depends on union state stateAt
 * has no access to (see plan's private/public split).
 *
 * `tz` is accepted for signature stability but unused — UTC only in v1.
 */
export function stateAt(seed: string, t: number, _tz: Tz = "UTC"): BlobState {
  const exprAt = (key: string, options: readonly Expression[]): Expression =>
    options[Math.floor(hash01(key) * options.length)]!;

  const day = dayKey(t);
  const candidates = [
    ...daySchedule(seed, day, exprAt),
    ...daySchedule(seed, addDays(day, -1), exprAt),
  ];

  // Last matching segment wins: previous day's sleep can spill into this
  // day's early hours and must override this day's own explore-from-midnight
  // default, and (within one day) a discovery overrides the explore/rest
  // backdrop it interrupts.
  let hit: Segment | undefined;
  for (const seg of candidates) {
    if (t >= seg.start && t < seg.end) hit = seg;
  }
  if (!hit) {
    // Between schedules (e.g. just past midnight before the new day's sleep
    // tail is accounted for) — default to explore, the diurnal baseline.
    return { activity: "explore", expression: idle, since: dayStart(day) };
  }
  return { activity: hit.activity, expression: hit.expression, since: hit.start };
}
