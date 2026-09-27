import {
  firstSegment,
  randomPersonality,
  stepWorld,
  type Attraction,
  type Identity,
  type Personality,
  type Kin,
  type Relationship,
  type RelationStatus,
  type Rng,
  type Segment,
  type Sex,
  type World,
  type WorldBlob,
} from "@blob-land/sim";
import { reserveBabyName } from "./names";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** How far ahead of now the world is lived, so clients always have something to play. */
export const LOOKAHEAD = 30 * MIN;
/** How often a region lives itself forward, in garden time (its alarm, src/region.ts). */
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

/**
 * A region's own tables, in its Durable Object's SQLite: everything its blobs
 * do. Append only: each entry runs once, in order (see `migrate`), so a
 * change to the schema is a new entry, never an edit to an old one.
 */
const MIGRATIONS = [
  `CREATE TABLE meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     region INTEGER NOT NULL,
     step INTEGER NOT NULL DEFAULT 0 -- how many steps it has lived: segments carry the one that wrote them
   );
   -- Couples, between any two grown-up blobs. Lasts until they break up.
   CREATE TABLE unions (
     id TEXT PRIMARY KEY,
     seed_a TEXT NOT NULL,
     seed_b TEXT NOT NULL, -- seed_a < seed_b
     started_at INTEGER NOT NULL,
     ended_at INTEGER, -- NULL while together
     last_birth_at INTEGER
   );
   CREATE UNIQUE INDEX unions_active_a ON unions(seed_a) WHERE ended_at IS NULL;
   CREATE UNIQUE INDEX unions_active_b ON unions(seed_b) WHERE ended_at IS NULL;
   -- Every blob living here: an account's own (owner_user_id set) or one born here.
   CREATE TABLE blobs (
     seed TEXT PRIMARY KEY,
     owner_user_id TEXT UNIQUE,
     name TEXT NOT NULL, -- the account's pseudo, or the child's name
     country TEXT, -- ISO 3166-1 alpha-2, shown as a flag; NULL stays anonymous
     visible INTEGER NOT NULL DEFAULT 1, -- an account can hide from the garden
     traits TEXT, -- frozen JSON look for a child, NULL when the seed draws it
     parent_union_id TEXT REFERENCES unions(id),
     born_at INTEGER NOT NULL,
     adult_at INTEGER NOT NULL,
     sex TEXT NOT NULL, -- female | male | none
     attraction TEXT NOT NULL, -- women | men | any
     personality TEXT NOT NULL, -- JSON
     energy REAL NOT NULL,
     mood REAL NOT NULL,
     last TEXT NOT NULL -- JSON: its latest segment, where the step picks up
   );
   -- The played-back timeline, a few days of it (older rows are pruned).
   CREATE TABLE segments (
     seed TEXT NOT NULL,
     start INTEGER NOT NULL,
     end INTEGER NOT NULL,
     activity TEXT NOT NULL,
     expression TEXT NOT NULL,
     x REAL NOT NULL,
     y REAL NOT NULL,
     rng INTEGER NOT NULL,
     with_seed TEXT, -- everyone else at a meet, comma-separated
     detail TEXT,
     step INTEGER NOT NULL,
     PRIMARY KEY (seed, start)
   );
   CREATE INDEX segments_end ON segments(end);
   CREATE INDEX segments_step ON segments(step);
   CREATE TABLE relationships (
     seed_a TEXT NOT NULL,
     seed_b TEXT NOT NULL, -- seed_a < seed_b
     friendship REAL NOT NULL,
     romance REAL NOT NULL,
     tension REAL NOT NULL,
     chemistry REAL NOT NULL,
     status TEXT NOT NULL,
     kin TEXT, -- parent | sibling
     ex INTEGER NOT NULL DEFAULT 0,
     meetings INTEGER NOT NULL DEFAULT 0,
     last_met_at INTEGER,
     PRIMARY KEY (seed_a, seed_b)
   );
   CREATE TABLE interactions (
     id TEXT PRIMARY KEY,
     seed_a TEXT NOT NULL,
     seed_b TEXT NOT NULL,
     kind TEXT NOT NULL,
     outcome TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER NOT NULL,
     rng INTEGER NOT NULL,
     d_friendship REAL NOT NULL,
     d_romance REAL NOT NULL,
     d_tension REAL NOT NULL
   );
   CREATE INDEX interactions_end ON interactions(ended_at);`,
];

/** Brings a region's tables up to date. */
export function migrate(storage: DurableObjectStorage) {
  const { sql } = storage;
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
    const done = sql.exec<{ v: number }>(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`).one().v;
    for (let v = done; v < MIGRATIONS.length; v++) {
      sql.exec(MIGRATIONS[v]!);
      sql.exec(`INSERT INTO schema_version (version) VALUES (?)`, v + 1);
    }
  });
}

/** Which region this is: set by the first request that reaches it (see region.ts). */
export function regionNumber(sql: SqlStorage): number | null {
  return sql.exec<{ region: number }>(`SELECT region FROM meta`).toArray()[0]?.region ?? null;
}

export interface Newcomer {
  seed: string;
  ownerUserId: string | null;
  name: string;
  country: string | null;
  identity: Identity;
}

/** A new blob, grown up and ready to live from `now`. Joining twice is a no-op. */
export function join(sql: SqlStorage, b: Newcomer, now: number, rng: Rng) {
  sql.exec(
    `INSERT OR IGNORE INTO blobs (seed, owner_user_id, name, country, born_at, adult_at, sex, attraction, personality, energy, mood, last)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.9, 0.15, ?)`,
    b.seed,
    b.ownerUserId,
    b.name,
    b.country,
    now,
    now,
    b.identity.sex,
    b.identity.attraction,
    JSON.stringify(randomPersonality(rng)),
    JSON.stringify(firstSegment(now, rng)),
  );
}

type BlobRow = {
  seed: string;
  traits: string | null;
  born_at: number;
  adult_at: number;
  sex: Sex;
  attraction: Attraction;
  personality: string;
  energy: number;
  mood: number;
  last: string;
  parent_a: string | null;
  parent_b: string | null;
};

type RelationshipRow = {
  seed_a: string;
  seed_b: string;
  friendship: number;
  romance: number;
  tension: number;
  chemistry: number;
  status: RelationStatus;
  kin: Kin | null;
  ex: number;
  meetings: number;
  last_met_at: number | null;
};

type UnionRow = {
  id: string;
  seed_a: string;
  seed_b: string;
  started_at: number;
  last_birth_at: number | null;
};

/** The region's blobs, with the relationships and couples they're in: a
 * blob only ever meets its own region's, so each region is a world of its own. */
function loadWorld(sql: SqlStorage): World {
  const world: World = { blobs: new Map(), relationships: new Map(), unions: [] };
  const blobs = sql.exec<BlobRow>(
    `SELECT b.seed, b.traits, b.born_at, b.adult_at, b.sex, b.attraction, b.personality, b.energy, b.mood, b.last,
            u.seed_a AS parent_a, u.seed_b AS parent_b
     FROM blobs b LEFT JOIN unions u ON u.id = b.parent_union_id`,
  );
  for (const r of blobs) {
    const blob: WorldBlob = {
      seed: r.seed,
      identity: { sex: r.sex, attraction: r.attraction },
      personality: JSON.parse(r.personality) as Personality,
      bornAt: r.born_at,
      adultAt: r.adult_at,
      parents: r.parent_a && r.parent_b ? [r.parent_a, r.parent_b] : null,
      traits: r.traits ? JSON.parse(r.traits) : null,
      vitals: { energy: r.energy, mood: r.mood },
      last: JSON.parse(r.last) as Segment,
    };
    world.blobs.set(blob.seed, blob);
  }
  for (const r of sql.exec<RelationshipRow>(`SELECT * FROM relationships`)) {
    const rel: Relationship = {
      a: r.seed_a,
      b: r.seed_b,
      friendship: r.friendship,
      romance: r.romance,
      tension: r.tension,
      chemistry: r.chemistry,
      status: r.status,
      kin: r.kin,
      ex: r.ex === 1,
      meetings: r.meetings,
      lastMetAt: r.last_met_at,
    };
    world.relationships.set(`${rel.a}|${rel.b}`, rel);
  }
  const unions = sql.exec<UnionRow>(`SELECT id, seed_a, seed_b, started_at, last_birth_at FROM unions WHERE ended_at IS NULL`);
  world.unions = [...unions].map((u) => ({ id: u.id, a: u.seed_a, b: u.seed_b, startedAt: u.started_at, endedAt: null, lastBirthAt: u.last_birth_at }));
  return world;
}

/**
 * Lives the region forward to `until` and stores what happened, all in one
 * transaction: a step that fails midway leaves the region as it was, and the
 * next one lives the same stretch again. Newborns' names are held in D1 first
 * (the namespace is garden-wide). Returns false when there was no one to live.
 *
 * ponytail: a step that fails after holding names leaves them held by
 * children never born; sweep directory rows with no blob if it ever matters.
 */
export async function step(storage: DurableObjectStorage, db: D1Database, now: number, rng: Rng, until: number): Promise<boolean> {
  const { sql } = storage;
  const world = loadWorld(sql);
  if (world.blobs.size === 0) return false;
  const region = regionNumber(sql)!;
  const lived = stepWorld(world, until, rng, MAX_CATCH_UP);
  const names: string[] = [];
  for (const { child } of lived.births) names.push(await reserveBabyName(db, child.seed, region, child.bornAt, rng));

  storage.transactionSync(() => {
    const n = sql.exec<{ step: number }>(`UPDATE meta SET step = step + 1 RETURNING step`).one().step;
    for (const u of lived.unionsStarted) sql.exec(`INSERT INTO unions (id, seed_a, seed_b, started_at) VALUES (?, ?, ?, ?)`, u.id, u.a, u.b, u.startedAt);
    // After the inserts: a couple can meet and split within one step.
    for (const u of lived.unionsEnded) sql.exec(`UPDATE unions SET ended_at = ? WHERE id = ?`, u.endedAt, u.id);
    lived.births.forEach(({ child, unionId }, i) => {
      sql.exec(`UPDATE unions SET last_birth_at = ? WHERE id = ?`, child.bornAt, unionId);
      sql.exec(
        `INSERT INTO blobs (seed, name, traits, parent_union_id, born_at, adult_at, sex, attraction, personality, energy, mood, last)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '{}')`,
        child.seed,
        names[i]!,
        JSON.stringify(child.traits),
        unionId,
        child.bornAt,
        child.adultAt,
        child.identity.sex,
        child.identity.attraction,
        JSON.stringify(child.personality),
      );
    });
    for (const s of lived.segments) {
      sql.exec(
        `INSERT OR REPLACE INTO segments (seed, start, end, activity, expression, x, y, rng, with_seed, detail, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.seed,
        s.start,
        s.end,
        s.activity,
        s.expression,
        s.x,
        s.y,
        s.rng,
        s.with?.join(",") ?? null,
        s.detail,
        n,
      );
    }
    for (const m of lived.meetings) {
      sql.exec(
        `INSERT INTO interactions (id, seed_a, seed_b, kind, outcome, started_at, ended_at, rng, d_friendship, d_romance, d_tension)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        m.id,
        m.a,
        m.b,
        m.kind,
        m.outcome,
        m.start,
        m.end,
        m.rng,
        m.delta.friendship,
        m.delta.romance,
        m.delta.tension,
      );
    }
    for (const r of lived.relationships) {
      sql.exec(
        `INSERT OR REPLACE INTO relationships (seed_a, seed_b, friendship, romance, tension, chemistry, status, kin, ex, meetings, last_met_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.a,
        r.b,
        r.friendship,
        r.romance,
        r.tension,
        r.chemistry,
        r.status,
        r.kin,
        r.ex ? 1 : 0,
        r.meetings,
        r.lastMetAt,
      );
    }
    // Only what the step owns (newborns included): identity and visibility belong to the player.
    for (const blob of world.blobs.values()) {
      sql.exec(`UPDATE blobs SET energy = ?, mood = ?, last = ? WHERE seed = ?`, blob.vitals.energy, blob.vitals.mood, JSON.stringify(blob.last), blob.seed);
    }
    sql.exec(`DELETE FROM segments WHERE end < ?`, now - KEEP_SEGMENTS);
    sql.exec(`DELETE FROM interactions WHERE ended_at < ?`, now - KEEP_SEGMENTS);
  });
  return true;
}

export interface GardenBlob {
  seed: string;
  pseudo: string;
  country: string | null;
  sex: Sex;
  attraction: Attraction;
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

type SegmentRow = {
  seed: string;
  start: number;
  end: number;
  activity: Segment["activity"];
  expression: string;
  x: number;
  y: number;
  rng: number;
  with_seed: string | null;
  detail: string | null;
};

/** Segments by blob: those still playing or to come, or (`sinceStep`) only those written after that step. */
export function segmentsOf(sql: SqlStorage, now: number, sinceStep?: number): Map<string, Segment[]> {
  const cols = `seed, start, end, activity, expression, x, y, rng, with_seed, detail`;
  const rows =
    sinceStep === undefined
      ? sql.exec<SegmentRow>(`SELECT ${cols} FROM segments WHERE end > ? ORDER BY start`, now - SEGMENT_HISTORY)
      : sql.exec<SegmentRow>(`SELECT ${cols} FROM segments WHERE step > ? ORDER BY start`, sinceStep);
  const out = new Map<string, Segment[]>();
  for (const { seed, with_seed, ...r } of rows) {
    let list = out.get(seed);
    if (!list) out.set(seed, (list = []));
    list.push({ ...r, with: with_seed?.split(",") ?? null });
  }
  return out;
}

/** Everyone born by `now`, with their couples and timelines: what every player of the region is sent. */
export function gardenView(sql: SqlStorage, now: number): ViewBlob[] {
  // Children born in the step's lookahead aren't here yet.
  const blobs = sql.exec<{
    seed: string;
    name: string;
    country: string | null;
    sex: Sex;
    attraction: Attraction;
    born_at: number;
    adult_at: number;
    owner_user_id: string | null;
    visible: number;
  }>(`SELECT seed, name, country, sex, attraction, born_at, adult_at, owner_user_id, visible FROM blobs WHERE born_at <= ?`, now);
  // A union started or ended in the lookahead hasn't happened yet either.
  const partner = new Map<string, string>();
  for (const u of sql.exec<{ seed_a: string; seed_b: string }>(
    `SELECT seed_a, seed_b FROM unions WHERE started_at <= ?1 AND (ended_at IS NULL OR ended_at > ?1)`,
    now,
  )) {
    partner.set(u.seed_a, u.seed_b);
    partner.set(u.seed_b, u.seed_a);
  }
  // Still nursing a broken heart a while after a breakup.
  const heartbroken = new Set<string>();
  for (const u of sql.exec<{ seed_a: string; seed_b: string }>(`SELECT seed_a, seed_b FROM unions WHERE ended_at > ?1 - ?2 AND ended_at <= ?1`, now, HEARTBREAK)) {
    heartbroken.add(u.seed_a);
    heartbroken.add(u.seed_b);
  }
  const segments = segmentsOf(sql, now);
  return [...blobs].map((b) => ({
    seed: b.seed,
    pseudo: b.name,
    country: b.country,
    sex: b.sex,
    attraction: b.attraction,
    bornAt: b.born_at,
    adultAt: b.adult_at,
    partner: partner.get(b.seed) ?? null,
    heartbroken: heartbroken.has(b.seed),
    segments: segments.get(b.seed) ?? [],
    owner: b.owner_user_id,
    visible: b.visible === 1,
  }));
}

/** How one blob gets on with everyone it has met. Accounts hidden from the garden stay hidden. */
export function relationshipsOf(sql: SqlStorage, seed: string, now: number) {
  return sql
    .exec(
      `SELECT o.seed, o.name, r.status, r.friendship, r.romance, r.tension, r.kin, r.meetings, r.last_met_at AS lastMetAt
       FROM relationships r
       JOIN blobs o ON o.seed = CASE WHEN r.seed_a = ?1 THEN r.seed_b ELSE r.seed_a END
       WHERE (r.seed_a = ?1 OR r.seed_b = ?1) AND o.born_at <= ?2 AND o.visible = 1`,
      seed,
      now,
    )
    .toArray();
}

/**
 * The region's news, newest first: couples forming and splitting, births, and
 * the fights everyone heard about (between blobs who matter to each other, or
 * can't stand each other: squabbles between acquaintances are everyday). Only
 * what has happened by now: the step lives a little ahead. Fights are kept as
 * long as interactions are (3 days).
 */
export function journal(sql: SqlStorage, now: number) {
  const shown = `a.visible = 1 AND b.visible = 1`;
  return sql
    .exec(
      `SELECT * FROM (
         SELECT u.started_at AS at, 'couple' AS kind, a.seed AS a, a.name AS aName, b.seed AS b, b.name AS bName, NULL AS c, NULL AS cName
         FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
         WHERE u.started_at <= ?1 AND ${shown}
         UNION ALL
         SELECT u.ended_at, 'breakup', a.seed, a.name, b.seed, b.name, NULL, NULL
         FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
         WHERE u.ended_at <= ?1 AND ${shown}
         UNION ALL
         SELECT k.born_at, 'birth', a.seed, a.name, b.seed, b.name, k.seed, k.name
         FROM blobs k JOIN unions u ON u.id = k.parent_union_id JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
         WHERE k.born_at <= ?1 AND ${shown}
         UNION ALL
         SELECT i.ended_at, 'fight', a.seed, a.name, b.seed, b.name, NULL, NULL
         FROM interactions i JOIN blobs a ON a.seed = i.seed_a JOIN blobs b ON b.seed = i.seed_b
         JOIN relationships r ON r.seed_a = i.seed_a AND r.seed_b = i.seed_b
         WHERE i.kind = 'argue' AND i.outcome = 'bad' AND i.ended_at <= ?1 AND ${shown}
           AND r.status IN ('lovers', 'ex', 'rivals', 'complicated', 'best_friends')
       ) ORDER BY at DESC LIMIT ?2`,
      now,
      JOURNAL_SIZE,
    )
    .toArray();
}
