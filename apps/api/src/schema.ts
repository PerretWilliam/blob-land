import { bigint, boolean, doublePrecision, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// The whole garden, in one Postgres database. Every table a region's blobs
// live in carries `region`, and every query about them filters on it: a
// region is only ever read and stepped by itself. Change this file, then
// `pnpm db:generate` writes the migration (migrations/, applied on start).
// All times are epoch milliseconds (UTC). The sim's aren't always whole
// (a segment can end mid-millisecond), so they're stored as double
// precision: exact for any epoch ms, and what clients chain segments on.

const ms = (name: string) => doublePrecision(name);

export const users = pgTable("users", {
  id: uuid().primaryKey(),
  pseudo: text().notNull(),
  seed: text().notNull().unique(), // normalizeSeed(pseudo), from blobatar
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  lastSeenAt: ms("last_seen_at").notNull(),
  createdAt: ms("created_at").notNull(),
});

/** One row per region: how full it is, how far it has lived, and when it's due again. */
export const regions = pgTable(
  "regions",
  {
    region: integer().primaryKey(),
    // Every blob that lives here, children about to be born included: kept by
    // a trigger on blobs (the population migration).
    population: integer().notNull().default(0),
    step: integer().notNull().default(0), // how many steps it has lived: segments carry the one that wrote them
    version: integer().notNull().default(0), // bumped by every change, so servers know their cached view is stale
    nextStepAt: ms("next_step_at").notNull().default(0), // real time, not garden time
  },
  (t) => [index("regions_due").on(t.nextStepAt)],
);

/**
 * Every blob: an account's own (ownerUserId set) or one born in the garden.
 * Pseudos and children's names are one namespace, and nameKey (normalizeSeed
 * of either) is its one unique key, so a sign-up and a birth can never take
 * the same name.
 */
export const blobs = pgTable(
  "blobs",
  {
    seed: text().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .unique()
      .references(() => users.id),
    name: text().notNull(), // the account's pseudo, or the child's name
    nameKey: text("name_key").notNull().unique(),
    region: integer().notNull(),
    country: text(), // ISO 3166-1 alpha-2, shown as a flag; null stays anonymous
    visible: boolean().notNull().default(true), // an account can hide from the garden
    traits: text(), // frozen JSON look for a child, null when the seed draws it
    parentUnionId: text("parent_union_id"),
    bornAt: ms("born_at").notNull(), // children are listed ahead of their birth: the step lives ahead
    adultAt: ms("adult_at").notNull(),
    sex: text().notNull(), // female | male | none
    attraction: text().notNull(), // women | men | any
    personality: text().notNull(), // JSON
    energy: doublePrecision().notNull(),
    mood: doublePrecision().notNull(),
    last: text().notNull(), // JSON: its latest segment, where the step picks up
  },
  (t) => [index("blobs_region").on(t.region, t.bornAt), index("blobs_parent").on(t.parentUnionId)],
);

/** Couples, between any two grown-up blobs. Lasts until they break up. */
export const unions = pgTable(
  "unions",
  {
    id: text().primaryKey(),
    region: integer().notNull(),
    seedA: text("seed_a").notNull(),
    seedB: text("seed_b").notNull(), // seedA < seedB
    startedAt: ms("started_at").notNull(),
    endedAt: ms("ended_at"), // null while together
    lastBirthAt: ms("last_birth_at"),
  },
  (t) => [
    uniqueIndex("unions_active_a").on(t.seedA).where(sql`ended_at IS NULL`),
    uniqueIndex("unions_active_b").on(t.seedB).where(sql`ended_at IS NULL`),
    index("unions_a").on(t.seedA),
    index("unions_b").on(t.seedB),
    index("unions_region").on(t.region),
  ],
);

/** The played-back timeline, a few days of it (older rows are pruned by the step). */
export const segments = pgTable(
  "segments",
  {
    seed: text().notNull(),
    region: integer().notNull(),
    start: ms("start_at").notNull(),
    end: ms("end_at").notNull(),
    activity: text().notNull(),
    expression: text().notNull(),
    x: doublePrecision().notNull(),
    y: doublePrecision().notNull(),
    rng: bigint("rng", { mode: "number" }).notNull(), // a uint32: too big for integer
    withSeed: text("with_seed"), // everyone else at a meet, comma-separated
    detail: text(),
    step: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.seed, t.start] }), index("segments_region_end").on(t.region, t.end), index("segments_region_step").on(t.region, t.step)],
);

export const relationships = pgTable(
  "relationships",
  {
    seedA: text("seed_a").notNull(),
    seedB: text("seed_b").notNull(), // seedA < seedB
    region: integer().notNull(),
    friendship: doublePrecision().notNull(),
    romance: doublePrecision().notNull(),
    tension: doublePrecision().notNull(),
    chemistry: doublePrecision().notNull(),
    status: text().notNull(),
    kin: text(), // parent | sibling
    ex: boolean().notNull().default(false),
    meetings: integer().notNull().default(0),
    lastMetAt: ms("last_met_at"),
  },
  (t) => [primaryKey({ columns: [t.seedA, t.seedB] }), index("relationships_b").on(t.seedB), index("relationships_region").on(t.region)],
);

export const interactions = pgTable(
  "interactions",
  {
    id: text().primaryKey(),
    region: integer().notNull(),
    seedA: text("seed_a").notNull(),
    seedB: text("seed_b").notNull(),
    kind: text().notNull(),
    outcome: text().notNull(),
    startedAt: ms("started_at").notNull(),
    endedAt: ms("ended_at").notNull(),
    rng: bigint("rng", { mode: "number" }).notNull(),
    dFriendship: doublePrecision("d_friendship").notNull(),
    dRomance: doublePrecision("d_romance").notNull(),
    dTension: doublePrecision("d_tension").notNull(),
  },
  (t) => [index("interactions_region_end").on(t.region, t.endedAt)],
);

/** Local dev only: where the sped-up garden clock is anchored (clock.ts). */
export const devClock = pgTable("dev_clock", {
  id: integer().primaryKey(),
  realAt: ms("real_at").notNull(),
  gardenAt: ms("garden_at").notNull(),
  scale: doublePrecision().notNull(),
});
