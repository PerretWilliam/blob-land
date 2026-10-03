import { randomRng, SPELL, type Rng, type Spell } from "@blob-land/sim";
import { eq, sql } from "drizzle-orm";
import { gardenNow } from "./clock";
import { db, type Db } from "./db";
import { config } from "./env";
import { gardenView, LOOKAHEAD, segmentsOf, step, STEP_EVERY, type ViewBlob } from "./garden";
import { tidy } from "./island";
import { regions } from "./schema";

/**
 * Lives `region` forward to `until`. The region's row is held for the whole
 * step, so steps of one region never overlap, on this server or any other,
 * and a change to it (touch) waits for the step to finish. Tests pass their own rng.
 */
export function live(region: number, now: number, until: number, rng: Rng = randomRng): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.select({ region: regions.region }).from(regions).where(eq(regions.region, region)).for("update");
    return step(tx, region, now, rng, until);
  });
}

/**
 * Marks `region` changed, so every server's cached view of it is rebuilt.
 * Call it first in the transaction that changes it: rows are always locked
 * region first, then blobs, as a step does, so the two can't deadlock.
 */
export async function touch(tx: Db, region: number) {
  await tx
    .update(regions)
    .set({ version: sql`${regions.version} + 1` })
    .where(eq(regions.region, region));
}

/** What every player of a region is sent, built once per change (see `regionGarden`). */
interface View {
  version: number;
  /** The step it shows the region after. */
  step: number;
  /** Garden time it was built at. */
  at: number;
  blobs: Promise<ViewBlob[]>;
  /** Answers already written, by `since` (-1: the whole timeline). */
  answers: Map<number, Promise<Answer>>;
}

/** An answer's blobs as JSON array items: the visible ones, the same for
 * everyone, and hidden accounts' own, by owner (each sees itself). */
interface Answer {
  shared: string;
  hidden: Map<string, string>;
}

// This server's views, by region; the oldest are dropped past this many.
const views = new Map<number, View>();
/** Dev reset: what was cached no longer exists. */
export const forgetViews = () => views.clear();
const MAX_VIEWS = 200;

const publicJson = ({ owner: _owner, visible: _visible, ...blob }: ViewBlob) => JSON.stringify(blob);

/**
 * A region as `viewer` plays it back, as the inside of a JSON object
 * (`"step":…,"delta":…,"weather":[…],"blobs":[…]`): the weather is the
 * spell on now and those rolled ahead, in full every time (a few of them). `since` (a step number from an earlier
 * answer) sends only the timeline written after it. The view is kept until
 * the region changes (its version, checked on each ask: one indexed read) or
 * is a step old, and shared by everyone asking meanwhile.
 */
export async function regionGarden(region: number, viewer: string, since: number | undefined, now: number): Promise<string> {
  // Read before the view: a step landing in between shows as newer
  // timeline under the older step number (asked again next time), never as
  // timeline skipped.
  // Any other version than the view's is a change, backwards too (the
  // database was restored or reset under a running server).
  const [row] = await db.select({ step: regions.step, version: regions.version, weather: regions.weather }).from(regions).where(eq(regions.region, region));
  if (!row) return `"step":0,"delta":false,"weather":[],"blobs":[]`;
  const { weather, ...meta } = row;
  const sky = JSON.stringify((JSON.parse(weather) as Spell[]).filter((s) => s.start + SPELL > now));
  let view = views.get(region);
  if (!view || view.version !== meta.version || now - view.at >= STEP_EVERY) {
    const fresh: View = { ...meta, at: now, blobs: gardenView(db, region, now), answers: new Map() };
    fresh.blobs.catch(() => views.get(region) === fresh && views.delete(region));
    views.delete(region);
    views.set(region, fresh);
    if (views.size > MAX_VIEWS) views.delete(views.keys().next().value!);
    view = fresh;
  }
  const delta = since !== undefined && since <= view.step;
  const answer = await answerFor(region, view, delta ? since : -1);
  const blobs = [answer.shared, answer.hidden.get(viewer)].filter(Boolean).join(",");
  return `"step":${view.step},"delta":${delta},"weather":${sky},"blobs":[${blobs}]`;
}

/**
 * The view's blobs with the whole timeline (`since` -1), or only what was
 * written after step `since`. Players come back every minute or so and
 * steps are five apart, so nearly all ask for one of the last couple of
 * steps: those answers are written once and kept; older ones aren't, so
 * no one can fill memory by asking for every step there ever was.
 */
function answerFor(region: number, view: View, since: number): Promise<Answer> {
  const kept = view.answers.get(since);
  if (kept) return kept;
  const answer = (async () => {
    const [blobs, segments] = await Promise.all([view.blobs, since < 0 ? null : segmentsOf(db, region, view.at, since)]);
    const timeline = (b: ViewBlob) => (segments ? (segments.get(b.seed) ?? []) : b.segments);
    // A hidden account isn't anyone's partner, or at anyone's meeting, to the
    // others: its seed is its pseudo. It still sees its own.
    const hidden = new Set(blobs.filter((b) => !b.visible).map((b) => b.seed));
    const unseen = (seed: string | null) => seed !== null && hidden.has(seed);
    const shared = (b: ViewBlob) => ({
      ...b,
      partner: unseen(b.partner) ? null : b.partner,
      segments: timeline(b).map((s) => (s.with?.some(unseen) ? { ...s, with: s.with.filter((w) => !unseen(w)) } : s)),
    });
    const own = (b: ViewBlob) => ({ ...b, segments: timeline(b) });
    return {
      shared: blobs.filter((b) => b.visible).map((b) => publicJson(shared(b))).join(","),
      hidden: new Map(blobs.filter((b) => !b.visible && b.owner).map((b) => [b.owner!, publicJson(own(b))] as const)),
    };
  })();
  if (since < 0 || since >= view.step - 2) {
    view.answers.set(since, answer);
    answer.catch(() => view.answers.delete(since));
  }
  return answer;
}

/** A region's step period in real time: STEP_EVERY of garden time. */
const every = () => Math.max(1000, STEP_EVERY / config.timeScale);
// Steps run at once by one server: half its connections, the rest stay for requests.
const STEPS_AT_ONCE = Math.max(1, Math.floor(config.poolSize / 2));

/**
 * Claims the regions due for a step and lives them; returns how many. The
 * claim moves each one's next step on first, and skips rows another server
 * holds, so any number of servers can run this side by side and each
 * region is stepped by one of them. A step that fails is tried again a
 * period later.
 */
export async function stepDue(): Promise<number> {
  const now = Date.now();
  const due = await db.execute<{ region: number }>(sql`
    UPDATE regions SET next_step_at = ${now + every()}
    WHERE region IN (
      SELECT region FROM regions WHERE next_step_at <= ${now}
      ORDER BY next_step_at LIMIT ${STEPS_AT_ONCE} FOR UPDATE SKIP LOCKED
    )
    RETURNING region`);
  await Promise.all(
    [...due].map(async ({ region }) => {
      try {
        const at = await gardenNow();
        // An island: its visitors whose stay is over go home first, or all of them if its player has gone.
        if (region < 0) await tidy(region, at, now);
        await live(region, at, at + LOOKAHEAD);
      } catch (e) {
        console.error(JSON.stringify({ event: "step_failed", region, error: String(e), stack: (e as Error).stack }));
      }
    }),
  );
  return due.length;
}

/** Steps due regions until the returned function is called (and awaited). */
export function startStepping(): () => Promise<void> {
  let running = true;
  const loop = (async () => {
    while (running) {
      const stepped = await stepDue().catch((e: unknown) => {
        console.error(JSON.stringify({ event: "step_claim_failed", error: String(e) }));
        return 0;
      });
      // More may be due right away; else look again in a second.
      if (stepped === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}
