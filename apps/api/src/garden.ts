import {
  compatible,
  firstSegment,
  personalityOf,
  randomPersonality,
  relationStatus,
  stepWorld,
  type Attraction,
  type Identity,
  type Kin,
  type Gait,
  type Personality,
  type RelationStatus,
  type Relationship,
  type Rng,
  type Segment,
  type Sex,
  type Spell,
  type World,
  type WorldBlob,
} from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { and, asc, eq, getTableColumns, gt, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./db";
import { babyName } from "./names";
import { blobs, interactions, milestones, regions, relationships, segments, unions } from "./schema";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** How far ahead of now the world is lived, so clients always have something to play. */
export const LOOKAHEAD = 30 * MIN;
/** How often a region lives itself forward, in garden time (region.ts). */
export const STEP_EVERY = 5 * MIN;
// A garden asleep for longer than this skips the gap rather than living it.
const MAX_CATCH_UP = 2 * DAY;
// Played-back history kept for journals.
const KEEP_SEGMENTS = 3 * DAY;
// How long after a breakup both still wear it, in garden time.
const HEARTBREAK = 45 * MIN;
// How much already-played timeline to send: enough for a smooth pick-up.
const SEGMENT_HISTORY = 15 * MIN;
const JOURNAL_SIZE = 60;
// Rows per multi-row write: well under Postgres' 65 535 parameters a statement.
const BATCH = 1000;

export interface Newcomer {
  seed: string;
  ownerUserId: string | null;
  name: string;
  country: string | null;
  identity: Identity;
  /** The player's choice; rolled when not given. */
  personality?: Personality;
  gait?: Gait | null;
}

/** New blobs in `region`, grown up and ready to live from `now`. */
export async function join(db: Db, region: number, newcomers: Newcomer[], now: number, rng: Rng) {
  const rows = newcomers.map((b) => ({
    seed: b.seed,
    ownerUserId: b.ownerUserId,
    name: b.name,
    nameKey: normalizeSeed(b.name),
    region,
    country: b.country,
    bornAt: now,
    adultAt: now,
    sex: b.identity.sex,
    attraction: b.identity.attraction,
    personality: JSON.stringify(b.personality ?? randomPersonality(rng)),
    gait: b.gait ?? null,
    energy: 0.9,
    mood: 0.15,
    last: JSON.stringify(firstSegment(now, rng)),
  }));
  for (const part of chunks(rows)) await db.insert(blobs).values(part);
}

/** The region's blobs, with the relationships and couples they're in: a
 * blob only ever meets its own region's, so each region is a world of its own. */
async function loadWorld(db: Db, region: number): Promise<World> {
  const [blobRows, relRows, unionRows, [sky]] = await Promise.all([
    db
      .select({
        seed: blobs.seed,
        traits: blobs.traits,
        bornAt: blobs.bornAt,
        adultAt: blobs.adultAt,
        sex: blobs.sex,
        attraction: blobs.attraction,
        personality: blobs.personality,
        energy: blobs.energy,
        mood: blobs.mood,
        last: blobs.last,
        parentA: unions.seedA,
        parentB: unions.seedB,
      })
      .from(blobs)
      .leftJoin(unions, eq(unions.id, blobs.parentUnionId))
      .where(eq(blobs.region, region)),
    db.select().from(relationships).where(eq(relationships.region, region)),
    db.select().from(unions).where(and(eq(unions.region, region), isNull(unions.endedAt))),
    db.select({ weather: regions.weather }).from(regions).where(eq(regions.region, region)),
  ]);
  const world: World = { blobs: new Map(), relationships: new Map(), unions: [], weather: JSON.parse(sky?.weather ?? "[]") as Spell[] };
  for (const r of blobRows) {
    const blob: WorldBlob = {
      seed: r.seed,
      identity: { sex: r.sex as Sex, attraction: r.attraction as Attraction },
      personality: personalityOf(JSON.parse(r.personality), r.seed),
      bornAt: r.bornAt,
      adultAt: r.adultAt,
      parents: r.parentA && r.parentB ? [r.parentA, r.parentB] : null,
      traits: r.traits ? JSON.parse(r.traits) : null,
      vitals: { energy: r.energy, mood: r.mood },
      last: JSON.parse(r.last) as Segment,
    };
    world.blobs.set(blob.seed, blob);
  }
  for (const r of relRows) {
    const { seedA: a, seedB: b, region: _region, status, kin, ...rest } = r;
    world.relationships.set(`${a}|${b}`, { a, b, status: status as RelationStatus, kin: kin as Kin | null, ...rest });
  }
  world.unions = unionRows.map((u) => ({ id: u.id, a: u.seedA, b: u.seedB, startedAt: u.startedAt, endedAt: null, lastBirthAt: u.lastBirthAt }));
  return world;
}

/**
 * Lives the region forward to `until` and stores what happened. Runs in the
 * caller's transaction, which holds the region's row (region.ts): a step
 * that fails midway leaves the region as it was, newborns' names included,
 * and the next one lives the same stretch again. Returns false when there
 * was no one to live.
 */
export async function step(tx: Db, region: number, now: number, rng: Rng, until: number): Promise<boolean> {
  const world = await loadWorld(tx, region);
  if (world.blobs.size === 0) return false;
  const lived = stepWorld(world, until, rng, MAX_CATCH_UP);
  const [{ step: n }] = (await tx
    .update(regions)
    .set({ step: sql`${regions.step} + 1`, version: sql`${regions.version} + 1`, weather: JSON.stringify(world.weather) })
    .where(eq(regions.region, region))
    .returning({ step: regions.step })) as [{ step: number }];

  if (lived.unionsStarted.length > 0) {
    await tx.insert(unions).values(lived.unionsStarted.map((u) => ({ id: u.id, region, seedA: u.a, seedB: u.b, startedAt: u.startedAt })));
  }
  // After the inserts: a couple can meet and split within one step.
  for (const u of lived.unionsEnded) await tx.update(unions).set({ endedAt: u.endedAt }).where(eq(unions.id, u.id));
  for (const { child, unionId } of lived.births) {
    await tx.update(unions).set({ lastBirthAt: child.bornAt }).where(eq(unions.id, unionId));
    await bear(tx, region, child, unionId, rng);
  }

  // A later segment can replace one written earlier in the same step: keep the last.
  const segmentRows = lastBy(
    lived.segments.map((s) => ({
      seed: s.seed,
      region,
      start: s.start,
      end: s.end,
      activity: s.activity,
      expression: s.expression,
      x: s.x,
      y: s.y,
      rng: s.rng,
      withSeed: s.with?.join(",") ?? null,
      detail: s.detail ?? null,
      step: n,
    })),
    (s) => `${s.seed}|${s.start}`,
  );
  for (const part of chunks(segmentRows)) {
    await tx
      .insert(segments)
      .values(part)
      .onConflictDoUpdate({ target: [segments.seed, segments.start], set: excluded(segments, ["end", "activity", "expression", "x", "y", "rng", "withSeed", "detail", "step"]) });
  }
  const meetingRows = lived.meetings.map((m) => ({
    id: m.id,
    region,
    seedA: m.a,
    seedB: m.b,
    kind: m.kind,
    outcome: m.outcome,
    startedAt: m.start,
    endedAt: m.end,
    rng: m.rng,
    dFriendship: m.delta.friendship,
    dRomance: m.delta.romance,
    dTension: m.delta.tension,
  }));
  for (const part of chunks(meetingRows)) await tx.insert(interactions).values(part);
  const milestoneRows = lived.milestones.map((m) => ({ seed: m.seed, region, kind: m.kind, key: m.key, withSeed: m.with.join(","), at: m.at }));
  for (const part of chunks(milestoneRows)) await tx.insert(milestones).values(part).onConflictDoNothing();
  const relationshipRows = lastBy(
    lived.relationships.map((r) => ({
      seedA: r.a,
      seedB: r.b,
      region,
      friendship: r.friendship,
      romance: r.romance,
      tension: r.tension,
      chemistry: r.chemistry,
      status: r.status,
      kin: r.kin,
      ex: r.ex,
      meetings: r.meetings,
      lastMetAt: r.lastMetAt,
    })),
    (r) => `${r.seedA}|${r.seedB}`,
  );
  for (const part of chunks(relationshipRows)) {
    await tx
      .insert(relationships)
      .values(part)
      .onConflictDoUpdate({
        target: [relationships.seedA, relationships.seedB],
        set: excluded(relationships, ["friendship", "romance", "tension", "chemistry", "status", "kin", "ex", "meetings", "lastMetAt"]),
      });
  }
  // Only what the step owns (newborns included): identity and visibility
  // belong to the player. One statement per batch rather than one per blob.
  for (const part of chunks([...world.blobs.values()])) {
    const values = sql.join(
      part.map((b) => sql`(${b.seed}, ${b.vitals.energy}, ${b.vitals.mood}, ${JSON.stringify(b.last)})`),
      sql`, `,
    );
    await tx.execute(
      sql`UPDATE blobs SET energy = v.energy::float8, mood = v.mood::float8, last = v.last
          FROM (VALUES ${values}) AS v(seed, energy, mood, last) WHERE blobs.seed = v.seed`,
    );
  }
  await tx.delete(segments).where(and(eq(segments.region, region), lt(segments.end, now - KEEP_SEGMENTS)));
  await tx.delete(interactions).where(and(eq(interactions.region, region), lt(interactions.endedAt, now - KEEP_SEGMENTS)));
  return true;
}

/**
 * After a player changes who their blob is (`seed`, now `identity`): romance
 * it can't feel any more fades at once, and a couple that can't be one any
 * more breaks up now, as exes; the heartbreak shows as after any breakup.
 * Runs in the caller's transaction, after `touch`.
 */
export async function reconsider(tx: Db, seed: string, identity: Identity, now: number) {
  const mine = or(eq(relationships.seedA, seed), eq(relationships.seedB, seed));
  const [rows, [union]] = await Promise.all([
    tx
      .select({ rel: relationships, sex: blobs.sex, attraction: blobs.attraction })
      .from(relationships)
      .innerJoin(blobs, eq(blobs.seed, sql`CASE WHEN ${relationships.seedA} = ${seed} THEN ${relationships.seedB} ELSE ${relationships.seedA} END`))
      .where(mine),
    tx
      .select()
      .from(unions)
      .where(and(or(eq(unions.seedA, seed), eq(unions.seedB, seed)), isNull(unions.endedAt))),
  ]);
  for (const { rel: row, sex, attraction } of rows) {
    if (compatible(identity, { sex: sex as Sex, attraction: attraction as Attraction })) continue;
    // Unions and relationships both keep the smaller seed first.
    const together = union?.seedA === row.seedA && union.seedB === row.seedB;
    if (row.romance === 0 && !together) continue;
    const { seedA: a, seedB: b, region: _region, status, kin, ...axes } = row;
    const rel: Relationship = { a, b, ...axes, status: status as RelationStatus, kin: kin as Kin | null, romance: 0, ex: row.ex || together };
    if (together) await tx.update(unions).set({ endedAt: Math.max(now, union.startedAt) }).where(eq(unions.id, union.id));
    await tx
      .update(relationships)
      .set({ romance: 0, ex: rel.ex, status: relationStatus(rel, false) })
      .where(and(eq(relationships.seedA, a), eq(relationships.seedB, b)));
  }
}

/**
 * Takes a deleted account's blob out of `region`, and its pseudo with it (free
 * to take again): its timeline, meetings and relationships go, and its
 * couple ends. The unions its children were born to stay, under a seed no
 * one can take, so the children keep their other parent and nothing leads
 * back to it. Runs in the caller's transaction, after `touch`.
 */
export async function forget(tx: Db, region: number, seed: string, now: number) {
  await tx
    .update(unions)
    .set({ endedAt: sql`GREATEST(${now}, ${unions.startedAt})` })
    .where(and(or(eq(unions.seedA, seed), eq(unions.seedB, seed)), isNull(unions.endedAt)));
  const gone = `gone-${crypto.randomUUID()}`;
  await tx.update(unions).set({ seedA: gone }).where(eq(unions.seedA, seed));
  await tx.update(unions).set({ seedB: gone }).where(eq(unions.seedB, seed));
  await tx.delete(relationships).where(or(eq(relationships.seedA, seed), eq(relationships.seedB, seed)));
  await tx.delete(interactions).where(or(eq(interactions.seedA, seed), eq(interactions.seedB, seed)));
  // Its album, and every moment of others' it was part of.
  await tx.delete(milestones).where(or(eq(milestones.seed, seed), sql`string_to_array(${milestones.withSeed}, ',') @> ARRAY[${seed}]`));
  await tx.delete(segments).where(eq(segments.seed, seed));
  // The others' meetings with it no longer say who with.
  await tx.execute(sql`
    UPDATE segments SET with_seed = NULLIF(array_to_string(array_remove(string_to_array(with_seed, ','), ${seed}), ','), '')
    WHERE region = ${region} AND string_to_array(with_seed, ',') @> ARRAY[${seed}]`);
  await tx.delete(blobs).where(eq(blobs.seed, seed));
}

/**
 * A newborn, under the first rolled name nobody has yet (after enough
 * misses, numbered): the name is taken by the insert itself, in the step's
 * transaction, so a failed step holds no name.
 */
async function bear(tx: Db, region: number, child: WorldBlob, unionId: string, rng: Rng) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = attempt < 20 ? babyName(rng) : `${babyName(rng)}${attempt}`;
    const born = await tx
      .insert(blobs)
      .values({
        seed: child.seed,
        name,
        nameKey: normalizeSeed(name),
        region,
        traits: JSON.stringify(child.traits),
        parentUnionId: unionId,
        bornAt: child.bornAt,
        adultAt: child.adultAt,
        sex: child.identity.sex,
        attraction: child.identity.attraction,
        personality: JSON.stringify(child.personality),
        energy: 0,
        mood: 0,
        last: "{}",
      })
      .onConflictDoNothing({ target: blobs.nameKey })
      .returning({ seed: blobs.seed });
    if (born.length > 0) return;
  }
  throw new Error(`no free name for ${child.seed}`);
}

export interface GardenBlob {
  seed: string;
  pseudo: string;
  country: string | null;
  sex: Sex;
  attraction: Attraction;
  personality: Personality;
  /** Picked by its player; null walks as its character does. */
  gait: Gait | null;
  bornAt: number;
  adultAt: number;
  partner: string | null;
  heartbroken: boolean;
  segments: Segment[];
}

/** A blob as the region serves it, with who may see it. */
export interface ViewBlob extends GardenBlob {
  owner: string | null;
  visible: boolean;
}

/** Segments by blob: those still playing or to come, or (`sinceStep`) only those written after that step. */
export async function segmentsOf(db: Db, region: number, now: number, sinceStep?: number): Promise<Map<string, Segment[]>> {
  const rows = await db
    .select({
      seed: segments.seed,
      start: segments.start,
      end: segments.end,
      activity: segments.activity,
      expression: segments.expression,
      x: segments.x,
      y: segments.y,
      rng: segments.rng,
      detail: segments.detail,
      withSeed: segments.withSeed,
    })
    .from(segments)
    .where(and(eq(segments.region, region), sinceStep === undefined ? gt(segments.end, now - SEGMENT_HISTORY) : gt(segments.step, sinceStep)))
    .orderBy(asc(segments.start));
  const out = new Map<string, Segment[]>();
  for (const { seed, withSeed, ...r } of rows) {
    let list = out.get(seed);
    if (!list) out.set(seed, (list = []));
    list.push({ ...r, activity: r.activity as Segment["activity"], with: withSeed?.split(",") ?? null });
  }
  return out;
}

/** Everyone born by `now`, with their couples and timelines: what every player of the region is sent. */
export async function gardenView(db: Db, region: number, now: number): Promise<ViewBlob[]> {
  const [blobRows, together, parted, timelines] = await Promise.all([
    // Children born in the step's lookahead aren't here yet.
    db
      .select({
        seed: blobs.seed,
        name: blobs.name,
        country: blobs.country,
        sex: blobs.sex,
        attraction: blobs.attraction,
        personality: blobs.personality,
        gait: blobs.gait,
        bornAt: blobs.bornAt,
        adultAt: blobs.adultAt,
        owner: blobs.ownerUserId,
        visible: blobs.visible,
      })
      .from(blobs)
      .where(and(eq(blobs.region, region), lte(blobs.bornAt, now))),
    // A union started or ended in the lookahead hasn't happened yet either.
    db
      .select({ a: unions.seedA, b: unions.seedB })
      .from(unions)
      .where(and(eq(unions.region, region), lte(unions.startedAt, now), or(isNull(unions.endedAt), gt(unions.endedAt, now)))),
    // Still nursing a broken heart a while after a breakup.
    db
      .select({ a: unions.seedA, b: unions.seedB })
      .from(unions)
      .where(and(eq(unions.region, region), gt(unions.endedAt, now - HEARTBREAK), lte(unions.endedAt, now))),
    segmentsOf(db, region, now),
  ]);
  const partner = new Map<string, string>();
  for (const u of together) {
    partner.set(u.a, u.b);
    partner.set(u.b, u.a);
  }
  const heartbroken = new Set(parted.flatMap((u) => [u.a, u.b]));
  return blobRows.map((b) => ({
    seed: b.seed,
    pseudo: b.name,
    country: b.country,
    sex: b.sex as Sex,
    attraction: b.attraction as Attraction,
    personality: personalityOf(JSON.parse(b.personality), b.seed),
    gait: b.gait as Gait | null,
    bornAt: b.bornAt,
    adultAt: b.adultAt,
    partner: partner.get(b.seed) ?? null,
    heartbroken: heartbroken.has(b.seed),
    segments: timelines.get(b.seed) ?? [],
    owner: b.owner,
    visible: b.visible,
  }));
}

/** How one blob gets on with everyone it has met. Accounts hidden from the garden stay hidden. */
export function relationshipsOf(db: Db, seed: string, now: number) {
  const other = sql`CASE WHEN ${relationships.seedA} = ${seed} THEN ${relationships.seedB} ELSE ${relationships.seedA} END`;
  return db
    .select({
      seed: blobs.seed,
      name: blobs.name,
      status: relationships.status,
      friendship: relationships.friendship,
      romance: relationships.romance,
      tension: relationships.tension,
      kin: relationships.kin,
      meetings: relationships.meetings,
      lastMetAt: relationships.lastMetAt,
    })
    .from(relationships)
    .innerJoin(blobs, eq(blobs.seed, other))
    .where(and(or(eq(relationships.seedA, seed), eq(relationships.seedB, seed)), lte(blobs.bornAt, now), eq(blobs.visible, true)));
}

/**
 * The region's news, newest first: couples forming and splitting, births, and
 * the fights everyone heard about (between blobs who matter to each other, or
 * can't stand each other: squabbles between acquaintances are everyday). Only
 * what has happened by now: the step lives a little ahead. Fights are kept as
 * long as interactions are (3 days). Plain SQL: a union of four is what an
 * ORM says worst.
 */
export async function journal(db: Db, region: number, now: number) {
  const shown = sql`a.visible AND b.visible`;
  return db.execute(sql`
    SELECT * FROM (
      SELECT u.started_at AS at, 'couple' AS kind, a.seed AS a, a.name AS "aName", b.seed AS b, b.name AS "bName", NULL AS c, NULL AS "cName"
      FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
      WHERE u.region = ${region} AND u.started_at <= ${now} AND ${shown}
      UNION ALL
      SELECT u.ended_at, 'breakup', a.seed, a.name, b.seed, b.name, NULL, NULL
      FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
      WHERE u.region = ${region} AND u.ended_at <= ${now} AND ${shown}
      UNION ALL
      SELECT k.born_at, 'birth', a.seed, a.name, b.seed, b.name, k.seed, k.name
      FROM blobs k JOIN unions u ON u.id = k.parent_union_id JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
      WHERE k.region = ${region} AND k.born_at <= ${now} AND ${shown}
      UNION ALL
      SELECT i.ended_at, 'fight', a.seed, a.name, b.seed, b.name, NULL, NULL
      FROM interactions i JOIN blobs a ON a.seed = i.seed_a JOIN blobs b ON b.seed = i.seed_b
      JOIN relationships r ON r.seed_a = i.seed_a AND r.seed_b = i.seed_b
      WHERE i.region = ${region} AND i.kind = 'argue' AND i.outcome = 'bad' AND i.ended_at <= ${now} AND ${shown}
        AND r.status IN ('lovers', 'ex', 'rivals', 'complicated', 'best_friends')
    ) news ORDER BY at DESC LIMIT ${JOURNAL_SIZE}`);
}

/**
 * A blob's album, newest first: what has happened by now (the step lives a
 * little ahead), with the names of who it was with. A moment with a blob
 * hidden from the garden is left out, as everywhere else.
 */
export async function album(db: Db, seed: string, now: number) {
  const rows = await db
    .select({ kind: milestones.kind, key: milestones.key, withSeed: milestones.withSeed, at: milestones.at })
    .from(milestones)
    .where(and(eq(milestones.seed, seed), lte(milestones.at, now)))
    .orderBy(sql`${milestones.at} DESC`);
  const others = [...new Set(rows.flatMap((r) => r.withSeed.split(",")))];
  const named = others.length === 0 ? [] : await db.select({ seed: blobs.seed, name: blobs.name, visible: blobs.visible }).from(blobs).where(inArray(blobs.seed, others));
  const shown = new Map(named.filter((b) => b.visible).map((b) => [b.seed, b.name]));
  return rows.flatMap(({ withSeed, ...r }) => {
    const seeds = withSeed.split(",");
    return seeds.every((s) => shown.has(s)) ? [{ ...r, with: seeds.map((s) => ({ seed: s, name: shown.get(s)! })) }] : [];
  });
}

/** An upsert's `SET col = excluded.col` for `keys` of `table`. */
function excluded<T extends PgTable>(table: T, keys: (keyof T["$inferInsert"] & string)[]): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(keys.map((k) => [k, sql.raw(`excluded."${columns[k]!.name}"`)]));
}

function* chunks<T>(rows: T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += BATCH) yield rows.slice(i, i + BATCH);
}

/** `rows` with one per key, the last one given. */
const lastBy = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];
