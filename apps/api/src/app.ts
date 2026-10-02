import { GAITS, gardenSize, isAttraction, isCountry, isGait, isPersonality, isSex, PERSONALITY_AXES, MAX_NAME_LENGTH, playerPseudo, randomRng, REGION_CAP, type Personality } from "@blob-land/sim";
import type { HttpBindings } from "@hono/node-server";
import { normalizeSeed } from "blobatar";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { hashPassword, verifyPassword } from "./auth";
import { gardenNow, resetTimeScale, setTimeScale } from "./clock";
import { db, isTaken, type Db } from "./db";
import { config } from "./env";
import { forget, join, journal, LOOKAHEAD, reconsider, relationshipsOf, type Newcomer } from "./garden";
import { cleanName, nameTaken } from "./names";
import { forgetViews, live, regionGarden, touch } from "./region";
import { blobs, regions, unions, users } from "./schema";
import { familyTree } from "./tree";

type Env = { Bindings: HttpBindings; Variables: { userId: string } };
export const app = new Hono<Env>();

// Desktop ships as a Tauri webview: macOS/Linux origin is tauri://localhost,
// Windows is http://tauri.localhost.
app.use(
  "*",
  cors({
    origin: (origin) => (origin === "tauri://localhost" || origin === "http://tauri.localhost" ? origin : ""),
  }),
);
// A whole region's timeline is a few hundred KB of JSON: a tenth of it gzipped.
app.use("*", compress());
// Nothing a player sends is bigger than a few fields.
app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

/** The signed-in player's id, or null: public routes show hidden players to themselves. */
async function viewerOf(c: Context<Env>): Promise<string | null> {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verify(header.slice(7), config.jwtSecret, "HS256").then(
    (payload) => payload.sub as string,
    () => null,
  );
}

const requireAuth = createMiddleware<Env>(async (c, next) => {
  const userId = await viewerOf(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
});

/**
 * Who's asking: the proxy's word for it when there is one (TRUST_PROXY), else
 * the socket's. The proxy appends the address it saw to X-Forwarded-For, so
 * only the last entry is its; anything before it came from the client.
 */
export const clientIp = (c: Context<Env>) =>
  (config.trustProxy && c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim()) || c.env?.incoming?.socket.remoteAddress || "unknown";

// Requests by IP in the current minute, per limited route group.
// ponytail: counted per server, so N servers allow N times the limit; move
// it to the reverse proxy or Postgres if that ever matters.
const attempts = new Map<string, { count: number; until: number }>();
const rateLimit = (group: string, perMinute: number) =>
  createMiddleware<Env>(async (c, next) => {
    const [key, now] = [`${group}:${clientIp(c)}`, Date.now()];
    let tries = attempts.get(key);
    if (!tries || tries.until <= now) {
      if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
      attempts.set(key, (tries = { count: 0, until: now + 60_000 }));
    }
    if (++tries.count > perMinute) return c.json({ error: "rate_limited" }, 429);
    await next();
  });
const rateLimitAuth = rateLimit("auth", config.authRateLimit);
// The app checks a pseudo once per try at joining: plenty of room.
const rateLimitPseudo = rateLimit("pseudo", 60);

const body = <T>(c: Context<Env>) => c.req.json<T>().catch(() => ({}) as T);
const token = (userId: string, now: number) => sign({ sub: userId, exp: Math.floor(now / 1000) + 60 * 60 * 24 * 30 }, config.jwtSecret, "HS256");
const logStepFailed = (region: number) => (e: unknown) =>
  console.error(JSON.stringify({ event: "step_failed", region, error: String(e), stack: (e as Error).stack }));

// For the container's health check and load balancers: up, and reaching Postgres.
app.get("/health", async (c) => {
  await db.execute(sql`SELECT 1`);
  return c.json({ ok: true });
});

// Public, no auth: lets the desktop client check a pseudo before it commits
// to /auth/register, so a collision with someone else's account doesn't
// surface only after the user has already typed a password (R7).
app.get("/pseudo/:p", rateLimitPseudo, async (c) => {
  const raw = c.req.param("p").trim();
  if (raw.length > MAX_NAME_LENGTH) return c.json({ error: `a pseudo is ${MAX_NAME_LENGTH} characters at most` }, 400);
  const seed = normalizeSeed(raw);
  // Deterministic short suffixes, the first 3 free ones offered when the
  // pseudo is taken — lets the desktop client offer variants right away
  // instead of just reporting the collision. Shortened to fit the length a
  // pseudo may have, and all checked in one query. Children's names count
  // too: pseudos and names are one namespace.
  const variant = (n: number) => `${raw.slice(0, MAX_NAME_LENGTH - String(n).length)}${n}`;
  const candidates = [raw, ...Array.from({ length: 98 }, (_, i) => variant(i + 2))];
  const rows = await db
    .select({ key: blobs.nameKey })
    .from(blobs)
    .where(inArray(blobs.nameKey, candidates.map(normalizeSeed)));
  const taken = new Set(rows.map((r) => r.key));
  if (!taken.has(seed)) return c.json({ seed, available: true });
  const suggestions = candidates
    .slice(1)
    .filter((name) => !taken.has(normalizeSeed(name)))
    .slice(0, 3);
  return c.json({ seed, available: false, suggestions });
});

const gaitError = `gait must be ${GAITS.join(", ")}, or null`;
const personalityError = `personality needs ${PERSONALITY_AXES.join(", ")}, each a number from 0 to 1`;
// Only the axes: anything else sent along is dropped.
const pick = (p: Personality) => Object.fromEntries(PERSONALITY_AXES.map((a) => [a, p[a]])) as Record<keyof Personality, number>;

type RegisterBody = { pseudo?: string; password?: string; sex?: unknown; attraction?: unknown; country?: unknown; friend?: unknown; personality?: unknown; gait?: unknown };

app.post("/auth/register", rateLimitAuth, async (c) => {
  const input = await body<RegisterBody>(c);
  const pseudo = cleanName(input.pseudo);
  const password = input.password;
  if (!pseudo || !password || password.length < 8) {
    return c.json({ error: `a pseudo of 1 to ${MAX_NAME_LENGTH} characters and a password of at least 8 are required` }, 400);
  }
  // Optional: a blob with no sex, drawn to anyone, unless the player says otherwise.
  const [sex, attraction] = [input.sex ?? "none", input.attraction ?? "any"];
  if (!isSex(sex) || !isAttraction(attraction)) return c.json({ error: "sex must be female, male or none; attraction women, men or any" }, 400);
  // Optional too: no country is fine, for those who'd rather stay anonymous.
  const country = input.country ?? null;
  if (country !== null && !isCountry(country)) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);
  // Optional: the private blob's character, so the garden one is the same blob. Rolled otherwise.
  const { personality } = input;
  if (personality !== undefined && !isPersonality(personality)) return c.json({ error: personalityError }, 400);
  const gait = input.gait ?? null;
  if (gait !== null && !isGait(gait)) return c.json({ error: gaitError }, 400);

  const seed = normalizeSeed(pseudo);
  if (await nameTaken(db, pseudo)) return c.json({ error: "pseudo already taken" }, 409);
  // Optional: a friend's pseudo, to live on their island.
  const friend = typeof input.friend === "string" && input.friend.trim() ? normalizeSeed(input.friend) : null;
  if (friend && (await db.select({ id: users.id }).from(users).where(eq(users.seed, friend))).length === 0) {
    return c.json({ error: "no account goes by that friend's pseudo" }, 404);
  }

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();
  const bornAt = await gardenNow();
  const newcomer: Newcomer = { seed, ownerUserId: id, name: pseudo, country, identity: { sex, attraction }, personality: personality && pick(personality), gait };
  let home: number;
  try {
    // The account and its blob, whole or not at all.
    home = await db.transaction(async (tx) => {
      await tx.insert(users).values({ id, pseudo, seed, passwordHash: hash, passwordSalt: salt, lastSeenAt: now, createdAt: now });
      const region = await placeAccount(tx, friend);
      await join(tx, region, [newcomer], bornAt, randomRng);
      return region;
    });
  } catch (e) {
    // Someone took the name between the check and the write.
    if (isTaken(e)) return c.json({ error: "pseudo already taken" }, 409);
    throw e;
  }
  // Newcomers have no timeline until a step: live the region now rather
  // than leave them standing still until its next. The sign-up is done
  // either way; the next step catches up if this one fails.
  await live(home, bornAt, bornAt + LOOKAHEAD).catch(logStepFailed(home));
  return c.json({ token: await token(id, now), seed }, 201);
});

app.post("/auth/login", rateLimitAuth, async (c) => {
  const input = await body<{ pseudo?: string; password?: string }>(c);
  if (!input.pseudo || !input.password) return c.json({ error: "pseudo and password are required" }, 400);

  const [user] = await db.select().from(users).where(eq(users.seed, normalizeSeed(input.pseudo)));
  if (!user || !(await verifyPassword(input.password, user.passwordHash, user.passwordSalt))) {
    return c.json({ error: "invalid pseudo or password" }, 401);
  }
  const now = Date.now();
  await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
  return c.json({ token: await token(user.id, now), seed: user.seed });
});

/** Where a player's blob lives, or null. */
async function homeOf(userId: string): Promise<number | null> {
  const [mine] = await db.select({ region: blobs.region }).from(blobs).where(eq(blobs.ownerUserId, userId));
  return mine?.region ?? null;
}

// One region of the garden at a time (?region=, else the player's own):
// all a client ever plays back, however big the garden gets. `since` (the
// `step` of an earlier answer for the same region) sends only the timeline
// written after it.
app.get("/garden", requireAuth, async (c) => {
  const [asked, since] = [c.req.query("region"), c.req.query("since")];
  if (asked !== undefined && !/^\d{1,9}$/.test(asked)) return c.json({ error: "region must be a non-negative integer" }, 400);
  if (since !== undefined && !/^\d{1,15}$/.test(since)) return c.json({ error: "since must be a step number from an earlier answer" }, 400);
  const now = await gardenNow();
  // Every region and how many live there (hidden players too: the island's
  // size must be the same for everyone), so the player can go and visit.
  const [home, all] = await Promise.all([
    homeOf(c.get("userId")),
    db.select({ region: regions.region, blobs: regions.population }).from(regions).orderBy(asc(regions.region)),
  ]);
  const n = asked !== undefined ? Number(asked) : (home ?? 0);
  const count = all.find((r) => r.region === n)?.blobs;
  const head = `"now":${now},"region":${n},"home":${home ?? 0},"regions":${JSON.stringify(all)},"size":${gardenSize(count ?? 0)},"rate":${config.timeScale}`;
  // Timelines, not states: the client plays the stored segments back itself.
  const region = count === undefined ? `"step":0,"delta":false,"blobs":[]` : await regionGarden(n, c.get("userId"), since === undefined ? undefined : Number(since), now);
  return c.body(`{${head},${region}}`, 200, { "content-type": "application/json" });
});

/** Changes what the player owns about their blob, and tells every server its region changed. */
async function changeMine(c: Context<Env>, changes: Partial<typeof blobs.$inferInsert>) {
  const home = await homeOf(c.get("userId"));
  if (home === null) return c.json({ error: "no blob for this account" }, 404);
  await db.transaction(async (tx) => {
    await touch(tx, home);
    await tx.update(blobs).set(changes).where(eq(blobs.ownerUserId, c.get("userId")));
  });
  return c.json({ ok: true });
}

// Where the player says they're from, or null to stop saying.
app.patch("/me/country", requireAuth, async (c) => {
  const { country } = await body<{ country?: unknown }>(c);
  if (country === undefined || (country !== null && !isCountry(country))) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);
  return changeMine(c, { country });
});

// A couple that can't be one any more breaks up (garden.ts, reconsider).
app.patch("/me/identity", requireAuth, async (c) => {
  const { sex, attraction } = await body<{ sex?: unknown; attraction?: unknown }>(c);
  if (!isSex(sex) || !isAttraction(attraction)) return c.json({ error: "sex (female, male, none) and attraction (women, men, any) are required" }, 400);
  const [mine] = await db.select({ seed: blobs.seed, region: blobs.region }).from(blobs).where(eq(blobs.ownerUserId, c.get("userId")));
  if (!mine) return c.json({ error: "no blob for this account" }, 404);
  const now = await gardenNow();
  await db.transaction(async (tx) => {
    await touch(tx, mine.region);
    await tx.update(blobs).set({ sex, attraction }).where(eq(blobs.seed, mine.seed));
    await reconsider(tx, mine.seed, { sex, attraction }, now);
  });
  return c.json({ ok: true });
});

// The player's say in their blob's character: the axes, all of them, kept as given.
app.patch("/me/personality", requireAuth, async (c) => {
  const { personality } = await body<{ personality?: unknown }>(c);
  if (!isPersonality(personality)) return c.json({ error: personalityError }, 400);
  return changeMine(c, { personality: JSON.stringify(pick(personality)) });
});

// How the player's blob walks, or null to walk as its character does.
app.patch("/me/gait", requireAuth, async (c) => {
  const { gait } = await body<{ gait?: unknown }>(c);
  if (gait !== null && !isGait(gait)) return c.json({ error: gaitError }, 400);
  return changeMine(c, { gait });
});

app.patch("/me/visibility", requireAuth, async (c) => {
  const { visible } = await body<{ visible?: unknown }>(c);
  if (typeof visible !== "boolean") return c.json({ error: "visible (boolean) is required" }, 400);
  return changeMine(c, { visible });
});

app.patch("/me/ping", requireAuth, async (c) => {
  await db.update(users).set({ lastSeenAt: Date.now() }).where(eq(users.id, c.get("userId")));
  return c.json({ ok: true });
});

// Gone for good: the account, its blob and its pseudo (free to take again).
// The password again, so a session left open can't do it.
app.delete("/me", rateLimitAuth, requireAuth, async (c) => {
  const { password } = await body<{ password?: unknown }>(c);
  const [user] = await db.select().from(users).where(eq(users.id, c.get("userId")));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash, user.passwordSalt))) {
    return c.json({ error: "wrong password" }, 403);
  }
  const home = await homeOf(user.id);
  const now = await gardenNow();
  await db.transaction(async (tx) => {
    if (home !== null) {
      await touch(tx, home);
      await forget(tx, home, user.seed, now);
    }
    await tx.delete(users).where(eq(users.id, user.id));
  });
  return c.json({ ok: true });
});

// Either parent can rename their child, within the shared pseudo/name namespace.
app.patch("/blobs/:seed/name", requireAuth, async (c) => {
  const seed = c.req.param("seed");
  const name = cleanName((await body<{ name?: unknown }>(c)).name);
  if (!name) return c.json({ error: `a name of 1 to ${MAX_NAME_LENGTH} characters is required` }, 400);
  const me = alias(blobs, "me");
  const [child] = await db
    .select({ region: blobs.region })
    .from(blobs)
    .innerJoin(unions, eq(unions.id, blobs.parentUnionId))
    .innerJoin(me, eq(me.ownerUserId, c.get("userId")))
    .where(and(eq(blobs.seed, seed), or(eq(unions.seedA, me.seed), eq(unions.seedB, me.seed))));
  if (!child) return c.json({ error: "only a parent can name this blob" }, 403);
  try {
    await db.transaction(async (tx) => {
      await touch(tx, child.region);
      await tx.update(blobs).set({ name, nameKey: normalizeSeed(name) }).where(eq(blobs.seed, seed));
    });
  } catch (e) {
    if (isTaken(e)) return c.json({ error: "name already taken" }, 409);
    throw e;
  }
  return c.json({ ok: true, name });
});

// How one blob gets on with everyone it has met: public, like the family tree.
// Accounts hidden from the garden stay hidden here too, but to themselves.
app.get("/blobs/:seed/relationships", async (c) => {
  const seed = c.req.param("seed");
  if (!(await shownTo(seed, await viewerOf(c)))) return c.json({ relationships: [] });
  return c.json({ relationships: await relationshipsOf(db, seed, await gardenNow()) });
});

// The news of the player's region (or ?region=): couples, breakups, births, big fights.
app.get("/garden/journal", requireAuth, async (c) => {
  const asked = c.req.query("region");
  if (asked !== undefined && !/^\d{1,9}$/.test(asked)) return c.json({ error: "region must be a non-negative integer" }, 400);
  const n = asked !== undefined ? Number(asked) : ((await homeOf(c.get("userId"))) ?? 0);
  const now = await gardenNow();
  return c.json({ now, events: [...(await journal(db, n, now))] });
});

// Genealogy is part of the public garden layer, not the private one: no auth
// needed, but a hidden player sees themselves in it (tree.ts).
app.get("/tree/:seed", async (c) => c.json(await familyTree(db, c.req.param("seed"), await gardenNow(), await viewerOf(c))));

/** Whether `seed` may be shown to `viewer`: an unknown seed, or another's hidden account, may not. */
async function shownTo(seed: string, viewer: string | null): Promise<boolean> {
  const [blob] = await db.select({ visible: blobs.visible, owner: blobs.ownerUserId }).from(blobs).where(eq(blobs.seed, seed));
  return !!blob && (blob.visible || blob.owner === viewer);
}

/**
 * Where a new account's blob will live. It moves in with `friend` (an
 * account's seed) while their region has room, a little past `cap`
 * (FRIENDS_ROOM), else into the first region with fewer than `cap`, so each
 * fills up (and gets lively) before the next opens, or opens the next when
 * all are full. Sign-ups are placed one at a time (the lock, held to the end
 * of the caller's transaction), so two can't both take a region's last place.
 */
export async function placeAccount(tx: Db, friend: string | null, cap = REGION_CAP): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLACEMENT_LOCK})`);
  if (friend) {
    const [theirs] = await tx
      .select({ region: regions.region, population: regions.population })
      .from(blobs)
      .innerJoin(regions, eq(regions.region, blobs.region))
      .where(and(eq(blobs.seed, friend), isNotNull(blobs.ownerUserId)));
    if (theirs && theirs.population < cap + FRIENDS_ROOM) return theirs.region;
  }
  const [open] = await tx.select({ region: regions.region }).from(regions).where(lt(regions.population, cap)).orderBy(asc(regions.region)).limit(1);
  if (open) return open.region;
  const [{ next }] = (await tx.select({ next: sql<number>`COALESCE(MAX(${regions.region}) + 1, 0)` }).from(regions)) as [{ next: number }];
  return next;
}
// How far past REGION_CAP friends can still squeeze in with each other.
const FRIENDS_ROOM = 50;
const PLACEMENT_LOCK = 7160618;

// Local tools, only where .env sets DEV_TOOLS=1: never in production.
const devTools = createMiddleware<Env>(async (c, next) => {
  if (!config.devTools) return c.notFound();
  await next();
});

// Every region lives forward now; `ahead` ms further still, to play a later
// step (the load test's clients coming back).
app.post("/__dev/step", devTools, async (c) => {
  const { ahead = 0 } = await body<{ ahead?: number }>(c);
  const now = await gardenNow();
  const all = await db.select({ region: regions.region }).from(regions);
  await Promise.all(all.map(({ region }) => live(region, now, now + LOOKAHEAD + ahead)));
  return c.json({ regions: all.length });
});

// How many times faster than real time the garden runs, from now on (the desktop's dev panel).
app.post("/__dev/time-scale", devTools, async (c) => {
  const { scale } = await body<{ scale?: number }>(c);
  if (typeof scale !== "number" || !(scale >= 1 && scale <= 1000)) return c.json({ error: "scale must be 1 to 1000" }, 400);
  return c.json({ now: await setTimeScale(scale), rate: scale });
});

// `count` blobs without accounts, filling new regions (for the load test,
// scripts/load.mjs), or topping up `region` to see an island at its fullest.
app.post("/__dev/populate", devTools, async (c) => {
  const { count, region: into } = await c.req.json<{ count: number; region?: number }>();
  if (!Number.isInteger(count) || count < 1 || count > 10_000) return c.json({ error: "count must be 1 to 10 000" }, 400);
  return c.json({ regions: await populate(count, into) });
});

// Back to zero: every table emptied, the garden's clock back to real time, then `count` blobs seeded.
app.post("/__dev/reset", devTools, async (c) => {
  const { count = 16 } = await body<{ count?: number }>(c);
  if (!Number.isInteger(count) || count < 0 || count > 10_000) return c.json({ error: "count must be 0 to 10 000" }, 400);
  await db.execute(sql`TRUNCATE users, regions, blobs, unions, segments, relationships, interactions, dev_clock RESTART IDENTITY CASCADE`);
  resetTimeScale();
  forgetViews();
  return c.json({ regions: count > 0 ? await populate(count) : [], rate: config.timeScale });
});

async function populate(count: number, into?: number): Promise<number[]> {
  const now = await gardenNow();
  const [{ first }] = (await db.select({ first: sql<number>`COALESCE(MAX(${regions.region}) + 1, 0)` }).from(regions)) as [{ first: number }];
  const sexes = ["female", "male", "none"] as const;
  const attractions = ["women", "men", "any"] as const;
  // Names like players pick, free in the garden-wide namespace.
  const taken = new Set((await db.select({ key: blobs.nameKey }).from(blobs)).map((r) => r.key));
  const freeName = () => {
    for (;;) {
      const name = playerPseudo(randomRng);
      if (taken.has(normalizeSeed(name))) continue;
      taken.add(normalizeSeed(name));
      return name;
    }
  };
  const byRegion = new Map<number, Newcomer[]>();
  for (let i = 0; i < count; i++) {
    const n = into ?? first + Math.floor(i / REGION_CAP);
    const blob = { seed: `load-${crypto.randomUUID().slice(0, 13)}`, ownerUserId: null, name: freeName(), country: null, identity: { sex: sexes[i % 3]!, attraction: attractions[(i >> 1) % 3]! } };
    byRegion.set(n, [...(byRegion.get(n) ?? []), blob]);
  }
  for (const [n, newcomers] of byRegion) {
    await join(db, n, newcomers, now, randomRng);
    await live(n, now, now + LOOKAHEAD);
  }
  return [...byRegion.keys()];
}

// Anything that breaks is logged whole, as one JSON line, for whatever collects the container's logs.
app.onError((e, c) => {
  console.error(JSON.stringify({ event: "request_failed", method: c.req.method, path: c.req.path, error: String(e), stack: e.stack }));
  return c.json({ error: "internal error" }, 500);
});
