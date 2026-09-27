import {
  firstSegment,
  randomPersonality,
  randomRng,
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
import { normalizeSeed } from "blobatar";
import { freeBabyName } from "./names";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** How far ahead of now the world is lived, so clients always have something to play. */
export const LOOKAHEAD = 30 * MIN;
// A garden asleep for longer than this skips the gap rather than living it.
const MAX_CATCH_UP = 2 * DAY;
// Played-back history kept for journals.
const KEEP_SEGMENTS = 3 * DAY;
// D1 caps statements per batch; stay well under.
const BATCH = 100;

interface BlobRow {
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
}

interface RelationshipRow {
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
}

interface UnionRow {
  id: string;
  seed_a: string;
  seed_b: string;
  started_at: number;
  last_birth_at: number | null;
}

/** A new account's blob, grown up and ready to live from `now`. */
export function newAccountBlob(db: D1Database, userId: string, seed: string, identity: Identity, now: number, rng: Rng = randomRng) {
  return db
    .prepare(
      `INSERT INTO blobs (seed, owner_user_id, born_at, adult_at, sex, attraction, personality, energy, mood, last)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0.9, 0.15, ?)`,
    )
    .bind(seed, userId, now, now, identity.sex, identity.attraction, JSON.stringify(randomPersonality(rng)), JSON.stringify(firstSegment(now, rng)));
}

async function loadWorld(db: D1Database): Promise<World> {
  const [{ results: blobs }, { results: rels }, { results: unions }] = await Promise.all([
    db
      .prepare(
        `SELECT b.seed, b.traits, b.born_at, b.adult_at, b.sex, b.attraction, b.personality, b.energy, b.mood, b.last,
                u.seed_a AS parent_a, u.seed_b AS parent_b
         FROM blobs b LEFT JOIN unions u ON u.id = b.parent_union_id`,
      )
      .all<BlobRow>(),
    db.prepare(`SELECT * FROM relationships`).all<RelationshipRow>(),
    db.prepare(`SELECT id, seed_a, seed_b, started_at, last_birth_at FROM unions WHERE ended_at IS NULL`).all<UnionRow>(),
  ]);
  const world: World = { blobs: new Map(), relationships: new Map(), unions: [] };
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
  for (const r of rels) {
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
  world.unions = unions.map((u) => ({ id: u.id, a: u.seed_a, b: u.seed_b, startedAt: u.started_at, endedAt: null, lastBirthAt: u.last_birth_at }));
  return world;
}

/**
 * Lives the whole garden forward to `until` (now + LOOKAHEAD by default)
 * and stores what happened. Run by the cron trigger only: one writer, so no
 * two steps ever roll the same stretch of time differently.
 *
 * ponytail: loads every blob and every relationship each run — fine for a
 * few hundred blobs; page by neighbourhood if the garden outgrows that.
 */
export async function advanceGarden(db: D1Database, now: number, rng: Rng = randomRng, until = now + LOOKAHEAD): Promise<void> {
  const world = await loadWorld(db);
  if (world.blobs.size === 0) return;
  // Blobs from before chronotypes get one, rolled once and stored.
  const writes: D1PreparedStatement[] = [];
  for (const blob of world.blobs.values()) {
    if (blob.personality.chronotype !== undefined) continue;
    blob.personality = { ...blob.personality, chronotype: rng() };
    writes.push(db.prepare(`UPDATE blobs SET personality = ? WHERE seed = ?`).bind(JSON.stringify(blob.personality), blob.seed));
  }
  const step = stepWorld(world, until, rng, MAX_CATCH_UP);

  for (const u of step.unionsStarted) {
    writes.push(db.prepare(`INSERT INTO unions (id, seed_a, seed_b, started_at) VALUES (?, ?, ?, ?)`).bind(u.id, u.a, u.b, u.startedAt));
  }
  // After the inserts: a couple can meet and split within one step.
  for (const u of step.unionsEnded) writes.push(db.prepare(`UPDATE unions SET ended_at = ? WHERE id = ?`).bind(u.endedAt, u.id));
  for (const { child, unionId } of step.births) {
    const name = await freeBabyName(db, rng);
    writes.push(
      db.prepare(`UPDATE unions SET last_birth_at = ? WHERE id = ?`).bind(child.bornAt, unionId),
      db
        .prepare(
          `INSERT INTO blobs (seed, name, name_key, traits, parent_union_id, born_at, adult_at, sex, attraction, personality, energy, mood, last)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '{}')`,
        )
        .bind(
          child.seed,
          name,
          normalizeSeed(name),
          JSON.stringify(child.traits),
          unionId,
          child.bornAt,
          child.adultAt,
          child.identity.sex,
          child.identity.attraction,
          JSON.stringify(child.personality),
        ),
    );
  }
  for (const s of step.segments) {
    writes.push(
      db
        .prepare(`INSERT OR REPLACE INTO segments (seed, start, end, activity, expression, x, y, rng, with_seed, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(s.seed, s.start, s.end, s.activity, s.expression, s.x, s.y, s.rng, s.with?.join(",") ?? null, s.detail),
    );
  }
  for (const m of step.meetings) {
    writes.push(
      db
        .prepare(
          `INSERT INTO interactions (id, seed_a, seed_b, kind, outcome, started_at, ended_at, rng, d_friendship, d_romance, d_tension)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(m.id, m.a, m.b, m.kind, m.outcome, m.start, m.end, m.rng, m.delta.friendship, m.delta.romance, m.delta.tension),
    );
  }
  for (const r of step.relationships) {
    writes.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO relationships (seed_a, seed_b, friendship, romance, tension, chemistry, status, kin, ex, meetings, last_met_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(r.a, r.b, r.friendship, r.romance, r.tension, r.chemistry, r.status, r.kin, r.ex ? 1 : 0, r.meetings, r.lastMetAt),
    );
  }
  // Only what the step owns (newborns included): identity and visibility belong to the player.
  for (const blob of world.blobs.values()) {
    writes.push(
      db.prepare(`UPDATE blobs SET energy = ?, mood = ?, last = ? WHERE seed = ?`).bind(blob.vitals.energy, blob.vitals.mood, JSON.stringify(blob.last), blob.seed),
    );
  }
  writes.push(db.prepare(`DELETE FROM segments WHERE end < ?`).bind(now - KEEP_SEGMENTS));
  writes.push(db.prepare(`DELETE FROM interactions WHERE ended_at < ?`).bind(now - KEEP_SEGMENTS));

  for (let i = 0; i < writes.length; i += BATCH) await db.batch(writes.slice(i, i + BATCH));
}
