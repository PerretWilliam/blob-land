/*
 * A player's home island, on the server while they're on it: a region of its
 * own (a negative number), stepped like any other. A blob is in one place at
 * a time: opening the island brings the player's blob home from the garden,
 * a visitor invited over leaves the garden for its stay, and closing it
 * sends everyone back where they came from. Nothing about it is shown to
 * anyone but its player.
 */
import { MAX_GUESTS, stayFor, type Rng, type Segment } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { and, count, desc, eq, gt, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, type Db } from "./db";
import { LOOKAHEAD } from "./garden";
import { live, touch } from "./region";
import { blobs, regions, relationships, segments, users } from "./schema";

// The player's app pings every minute while open: this long without one, it's closed.
export const HOST_GONE = 3 * 60 * 1000;
// Not stepped while no one's there.
const CLOSED = Number.MAX_SAFE_INTEGER;
const ISLAND_LOCK = 7160619;

/** A request the player can't have: said by the route as `error`, with `status`. */
export class IslandError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/** `seed`'s island region, made the first time. */
async function islandOf(tx: Db, seed: string): Promise<number> {
  const find = async () => (await tx.select({ region: regions.region }).from(regions).where(eq(regions.host, seed)))[0]?.region;
  const found = await find();
  if (found !== undefined) return found;
  // One at a time, so two new islands can't take the same number.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ISLAND_LOCK})`);
  const again = await find();
  if (again !== undefined) return again;
  const [{ next }] = (await tx.select({ next: sql<number>`LEAST(COALESCE(MIN(${regions.region}), 0), 0) - 1` }).from(regions)) as [{ next: number }];
  await tx.insert(regions).values({ region: next, host: seed, nextStepAt: CLOSED });
  return next;
}

/**
 * Moves `seed` to region `to` at `now`: what it had lived ahead is dropped,
 * and it carries on from what it's doing now, timeline and all. Call it
 * after touching both regions.
 */
async function move(tx: Db, seed: string, to: number, now: number, away: { awayFrom: number | null; stayUntil: number | null }) {
  await tx.delete(segments).where(and(eq(segments.seed, seed), gt(segments.start, now)));
  const [cur] = await tx.select().from(segments).where(eq(segments.seed, seed)).orderBy(desc(segments.start)).limit(1);
  await tx.update(segments).set({ region: to }).where(eq(segments.seed, seed));
  // Bonds first made on an island belong to the garden it goes back to.
  if (to >= 0) await tx.update(relationships).set({ region: to }).where(and(lt(relationships.region, 0), or(eq(relationships.seedA, seed), eq(relationships.seedB, seed))));
  const last: Segment | undefined = cur && {
    start: cur.start,
    end: cur.end,
    activity: cur.activity as Segment["activity"],
    expression: cur.expression,
    x: cur.x,
    y: cur.y,
    rng: cur.rng,
    with: cur.withSeed?.split(",") ?? null,
    detail: cur.detail,
  };
  await tx
    .update(blobs)
    .set({ region: to, ...away, ...(last ? { last: JSON.stringify(last) } : {}) })
    .where(eq(blobs.seed, seed));
}

/** Locks regions in one order (islands, being negative, first), as `touch` asks. */
async function touchAll(tx: Db, list: number[]) {
  for (const r of [...new Set(list)].sort((a, b) => a - b)) await touch(tx, r);
}

const mine = async (tx: Db, userId: string) =>
  (await tx.select({ seed: blobs.seed, region: blobs.region, awayFrom: blobs.awayFrom }).from(blobs).where(eq(blobs.ownerUserId, userId)))[0];

/** The player's blob comes home to their island (from the garden, or from visiting). Returns the island's region. */
export async function openIsland(userId: string, now: number): Promise<number | null> {
  const island = await db.transaction(async (tx) => {
    const me = await mine(tx, userId);
    if (!me) return null;
    const island = await islandOf(tx, me.seed);
    if (me.region === island) return island;
    await touchAll(tx, [me.region, island]);
    await move(tx, me.seed, island, now, { awayFrom: me.awayFrom ?? me.region, stayUntil: null });
    await tx.update(regions).set({ nextStepAt: 0 }).where(eq(regions.region, island));
    return island;
  });
  if (island !== null) await live(island, now, now + LOOKAHEAD);
  return island;
}

/** The player's island, if their blob is home on it. */
export async function openIslandOf(userId: string): Promise<number | null> {
  const me = await mine(db, userId);
  if (!me || me.region >= 0) return null;
  const [own] = await db.select({ region: regions.region }).from(regions).where(and(eq(regions.region, me.region), eq(regions.host, me.seed)));
  return own?.region ?? null;
}

/** Everyone on `island` (or only `seeds`) goes back to the garden they came from. Closing it all puts it to sleep. */
export async function sendHome(island: number, now: number, seeds?: string[]) {
  await db.transaction(async (tx) => {
    const here = (await tx.select({ seed: blobs.seed, awayFrom: blobs.awayFrom }).from(blobs).where(eq(blobs.region, island))).filter((b) => !seeds || seeds.includes(b.seed));
    if (here.length === 0) return;
    await touchAll(tx, [island, ...here.map((b) => b.awayFrom ?? 0)]);
    for (const b of here) await move(tx, b.seed, b.awayFrom ?? 0, now, { awayFrom: null, stayUntil: null });
    if (!seeds) await tx.update(regions).set({ nextStepAt: CLOSED }).where(eq(regions.region, island));
  });
}

/** `name`'s blob, a player's, comes over to the player's open island for a stay rolled now. */
export async function invite(userId: string, name: string, now: number, rng: Rng) {
  const island = await openIslandOf(userId);
  if (island === null) throw new IslandError("open your island first", 409);
  await db.transaction(async (tx) => {
    // The island first: two invitations at once count the guests one after the other.
    await touch(tx, island);
    const me = await mine(tx, userId);
    const [guest] = await tx
      .select({ seed: blobs.seed, region: blobs.region, awayFrom: blobs.awayFrom })
      .from(blobs)
      .where(and(eq(blobs.nameKey, normalizeSeed(name.trim())), isNotNull(blobs.ownerUserId), eq(blobs.visible, true), lte(blobs.bornAt, now)));
    if (!guest || guest.seed === me?.seed) throw new IslandError("no player goes by that pseudo", 404);
    if (guest.region === island) return;
    if (guest.awayFrom !== null) throw new IslandError("that blob is away from the garden", 409);
    const [{ n }] = (await tx.select({ n: count() }).from(blobs).where(and(eq(blobs.region, island), ne(blobs.seed, me!.seed)))) as [{ n: number }];
    if (n >= MAX_GUESTS) throw new IslandError("your island is full", 409);
    const [a, b] = [me!.seed, guest.seed].sort() as [string, string];
    const [rel] = await tx.select().from(relationships).where(and(eq(relationships.seedA, a), eq(relationships.seedB, b)));
    await touch(tx, guest.region);
    await move(tx, guest.seed, island, now, { awayFrom: guest.region, stayUntil: now + stayFor(rel ?? null, rng) });
  });
  await live(island, now, now + LOOKAHEAD);
}

/**
 * Before an island's step: if its player's app has gone quiet (`real`, real
 * time), everyone goes home; else visitors whose stay is over (`now`,
 * garden time) do.
 */
export async function tidy(island: number, now: number, real: number) {
  const [host] = await db
    .select({ seed: blobs.seed, region: blobs.region, seen: users.lastSeenAt })
    .from(regions)
    .innerJoin(blobs, eq(blobs.seed, regions.host))
    .innerJoin(users, eq(users.id, blobs.ownerUserId))
    .where(eq(regions.region, island));
  if (!host || host.region !== island || host.seen < real - HOST_GONE) return sendHome(island, now);
  const over = await db
    .select({ seed: blobs.seed })
    .from(blobs)
    .where(and(eq(blobs.region, island), lte(blobs.stayUntil, now)));
  if (over.length > 0) await sendHome(island, now, over.map((b) => b.seed));
}
