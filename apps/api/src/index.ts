import { gardenSize, isAttraction, isCountry, isSex, MAX_NAME_LENGTH, playerPseudo, randomRng, REGION_CAP } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { hashPassword, verifyPassword } from "./auth";
import { gardenNow, timeScale } from "./clock";
import type { Env } from "./env";
import { cleanName, isTaken, nameTaken } from "./names";
import { region } from "./region";
import { noTree } from "./tree";

type Vars = { userId: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Desktop ships as a Tauri webview: macOS/Linux origin is tauri://localhost,
// Windows is http://tauri.localhost.
app.use(
  "*",
  cors({
    origin: (origin) => (origin === "tauri://localhost" || origin === "http://tauri.localhost" ? origin : ""),
  }),
);

const requireAuth = createMiddleware<{ Bindings: Env; Variables: Vars }>(async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "unauthorized" }, 401);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, "HS256");
    c.set("userId", payload.sub as string);
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

const rateLimitAuth = createMiddleware<{ Bindings: Env; Variables: Vars }>(async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: "rate_limited" }, 429);
  await next();
});

interface UserRow {
  id: string;
  pseudo: string;
  seed: string;
  password_hash: string;
  password_salt: string;
}

// Public, no auth: lets the desktop client check a pseudo before it commits
// to /auth/register, so a collision with someone else's account doesn't
// surface only after the user has already typed a password (R7).
app.get("/pseudo/:p", async (c) => {
  const raw = c.req.param("p");
  const seed = normalizeSeed(raw);
  // Children's names count too: pseudos and names are one namespace.
  if (!(await nameTaken(c.env.DB, raw))) return c.json({ seed, available: true });

  // Deterministic short suffixes, checked in order, until 3 free ones are
  // found — lets the desktop client offer variants right away instead of
  // just reporting the collision.
  const suggestions: string[] = [];
  for (let i = 2; suggestions.length < 3 && i < 100; i++) {
    const candidate = `${raw}${i}`;
    if (!(await nameTaken(c.env.DB, candidate))) suggestions.push(candidate);
  }
  return c.json({ seed, available: false, suggestions });
});

type RegisterBody = { pseudo?: string; password?: string; sex?: unknown; attraction?: unknown; country?: unknown; friend?: unknown };

app.post("/auth/register", rateLimitAuth, async (c) => {
  const body = await c.req.json<RegisterBody>().catch(() => ({}) as RegisterBody);
  const pseudo = cleanName(body.pseudo);
  const password = body.password;
  if (!pseudo || !password || password.length < 8) {
    return c.json({ error: `a pseudo of 1 to ${MAX_NAME_LENGTH} characters and a password of at least 8 are required` }, 400);
  }
  // Optional: a blob with no sex, drawn to anyone, unless the player says otherwise.
  const [sex, attraction] = [body.sex ?? "none", body.attraction ?? "any"];
  if (!isSex(sex) || !isAttraction(attraction)) return c.json({ error: "sex must be female, male or none; attraction women, men or any" }, 400);
  // Optional too: no country is fine, for those who'd rather stay anonymous.
  const country = body.country ?? null;
  if (country !== null && !isCountry(country)) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);

  const seed = normalizeSeed(pseudo);
  if (await nameTaken(c.env.DB, pseudo)) return c.json({ error: "pseudo already taken" }, 409);
  // Optional: a friend's pseudo, to live on their island.
  const friend = typeof body.friend === "string" && body.friend.trim() ? normalizeSeed(body.friend) : null;
  if (friend && !(await c.env.DB.prepare(`SELECT 1 FROM users WHERE seed = ?`).bind(friend).first())) {
    return c.json({ error: "no account goes by that friend's pseudo" }, 404);
  }

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = c.env.DB;
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO users (id, pseudo, seed, password_hash, password_salt, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, pseudo, seed, hash, salt, now, now),
      placeAccount(db, id, seed, await gardenNow(c.env), friend),
    ]);
  } catch (e) {
    // Someone took the name between the check and the write.
    if (isTaken(e)) return c.json({ error: "pseudo already taken" }, 409);
    throw e;
  }
  // Then the blob moves into its region. If it can't, the account is undone,
  // so a sign-up either happens whole or can be tried again.
  const home = (await db.prepare(`SELECT region FROM blobs WHERE seed = ?`).bind(seed).first<number>("region"))!;
  const joined = await region(c.env, home, "/join", { method: "POST", body: JSON.stringify({ seed, ownerUserId: id, name: pseudo, country, identity: { sex, attraction } }) }).catch(
    (e: unknown) => e,
  );
  if (!(joined instanceof Response && joined.ok)) {
    await db.batch([db.prepare(`DELETE FROM blobs WHERE seed = ?`).bind(seed), db.prepare(`DELETE FROM users WHERE id = ?`).bind(id)]);
    throw new Error(`region ${home} refused ${seed}: ${joined instanceof Response ? joined.status : String(joined)}`);
  }

  const token = await sign({ sub: id, exp: Math.floor(now / 1000) + 60 * 60 * 24 * 30 }, c.env.JWT_SECRET, "HS256");
  return c.json({ token, seed }, 201);
});

app.post("/auth/login", rateLimitAuth, async (c) => {
  const body = await c.req.json<{ pseudo?: string; password?: string }>().catch(() => ({}) as { pseudo?: string; password?: string });
  if (!body.pseudo || !body.password) return c.json({ error: "pseudo and password are required" }, 400);

  const seed = normalizeSeed(body.pseudo);
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE seed = ?`).bind(seed).first<UserRow>();
  if (!user || !(await verifyPassword(body.password, user.password_hash, user.password_salt))) {
    return c.json({ error: "invalid pseudo or password" }, 401);
  }

  const now = Date.now();
  await c.env.DB.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now, user.id).run();
  const token = await sign({ sub: user.id, exp: Math.floor(now / 1000) + 60 * 60 * 24 * 30 }, c.env.JWT_SECRET, "HS256");
  return c.json({ token, seed });
});

/** Where a player's blob lives. */
const homeOf = (db: D1Database, userId: string) => db.prepare(`SELECT region FROM blobs WHERE owner_user_id = ?`).bind(userId).first<number>("region");
/** Where any blob lives, or null for a seed no one has. */
const regionOf = (db: D1Database, seed: string) => db.prepare(`SELECT region FROM blobs WHERE seed = ?`).bind(seed).first<number>("region");

// One region of the garden at a time (?region=, else the player's own):
// all a client ever plays back, however big the garden gets. `since` (the
// `step` of an earlier answer for the same region) sends only the timeline
// written after it.
app.get("/garden", requireAuth, async (c) => {
  const [asked, since] = [c.req.query("region"), c.req.query("since")];
  if (asked !== undefined && !/^\d{1,9}$/.test(asked)) return c.json({ error: "region must be a non-negative integer" }, 400);
  if (since !== undefined && !/^\d{1,15}$/.test(since)) return c.json({ error: "since must be a step number from an earlier answer" }, 400);
  const now = await gardenNow(c.env);
  const db = c.env.DB;
  // Every region and how many live there (hidden players too: the island's
  // size must be the same for everyone), so the player can go and visit.
  const [mine, all] = await db.batch<{ region: number; blobs: number }>([
    db.prepare(`SELECT region FROM blobs WHERE owner_user_id = ?`).bind(c.get("userId")),
    db.prepare(`SELECT region, COUNT(*) AS blobs FROM blobs WHERE born_at <= ? GROUP BY region ORDER BY region`).bind(now),
  ]);
  const regions = all!.results;
  const home = mine!.results[0]?.region ?? 0;
  const n = asked !== undefined ? Number(asked) : home;
  const count = regions.find((r) => r.region === n)?.blobs;
  const head = `"now":${now},"region":${n},"home":${home},"regions":${JSON.stringify(regions)},"size":${gardenSize(count ?? 0)},"rate":${timeScale(c.env)}`;
  // A region no one lives in yet: nothing to ask its object (and no object to wake).
  if (count === undefined) return c.body(`{${head},"step":0,"delta":false,"blobs":[]}`, 200, { "content-type": "application/json" });
  const query = new URLSearchParams({ viewer: c.get("userId"), ...(since !== undefined && { since }) });
  const res = await region(c.env, n, `/garden?${query}`);
  if (!res.ok) throw new Error(`region ${n} garden failed: ${res.status}`);
  // Timelines, not states: the client plays the stored segments back itself.
  // The region's answer goes out as it came, behind the garden-wide fields.
  return c.body(`{${head},${(await res.text()).slice(1)}`, 200, { "content-type": "application/json" });
});

/** Passes a player's change to their blob on to its region. */
const member = (route: string, field = route) =>
  app.patch(`/me/${route}`, requireAuth, async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const home = await homeOf(c.env.DB, c.get("userId"));
    if (home === null) return c.json({ error: "no blob for this account" }, 404);
    const patch = field === "identity" ? { sex: body.sex, attraction: body.attraction } : { [field]: body[field] };
    return region(c.env, home, "/member", { method: "PATCH", body: JSON.stringify({ owner: c.get("userId"), ...patch }) });
  });
// Where the player says they're from, or null to stop saying.
member("country");
member("identity");
member("visibility", "visible");

app.patch("/me/ping", requireAuth, async (c) => {
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now, c.get("userId")).run();
  return c.json({ ok: true });
});

// Either parent can rename their child, within the shared pseudo/name namespace.
app.patch("/blobs/:seed/name", requireAuth, async (c) => {
  const seed = c.req.param("seed");
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const n = await regionOf(c.env.DB, seed);
  if (n === null) return c.json({ error: "only a parent can name this blob" }, 403);
  return region(c.env, n, "/name", { method: "PATCH", body: JSON.stringify({ seed, name: body.name, viewer: c.get("userId") }) });
});

// How one blob gets on with everyone it has met: public, like the family tree.
// Accounts hidden from the garden stay hidden here too.
app.get("/blobs/:seed/relationships", async (c) => {
  const seed = c.req.param("seed");
  const n = await regionOf(c.env.DB, seed);
  if (n === null) return c.json({ relationships: [] });
  return region(c.env, n, `/relationships/${encodeURIComponent(seed)}`);
});

// The news of the player's region (or ?region=): couples, breakups, births, big fights.
app.get("/garden/journal", requireAuth, async (c) => {
  const asked = c.req.query("region");
  if (asked !== undefined && !/^\d{1,9}$/.test(asked)) return c.json({ error: "region must be a non-negative integer" }, 400);
  const n = asked !== undefined ? Number(asked) : ((await homeOf(c.env.DB, c.get("userId"))) ?? 0);
  if (!(await c.env.DB.prepare(`SELECT 1 FROM blobs WHERE region = ? LIMIT 1`).bind(n).first())) return c.json({ now: await gardenNow(c.env), events: [] });
  return region(c.env, n, "/journal");
});

// Genealogy is part of the public garden layer, not the private one — no auth.
app.get("/tree/:seed", async (c) => {
  const seed = c.req.param("seed");
  const n = await regionOf(c.env.DB, seed);
  if (n === null) return c.json(noTree(seed));
  return region(c.env, n, `/tree/${encodeURIComponent(seed)}`);
});

/**
 * A new account's blob in the directory, in the region it'll live in. It
 * moves in with `friend` (an account's seed) while their region has room, a
 * little past `cap` (FRIENDS_ROOM), else into the first region with fewer
 * than `cap`, so each fills up (and gets lively) before the next opens, or
 * opens the next when all are full. Picked inside the insert: D1 runs writes
 * one at a time, so two sign-ups can't both take a region's last place.
 */
export function placeAccount(db: D1Database, userId: string, seed: string, bornAt: number, friend: string | null, cap = REGION_CAP) {
  return db
    .prepare(
      `INSERT INTO blobs (seed, owner_user_id, name_key, region, born_at) VALUES (?1, ?2, ?1, COALESCE(
         (SELECT f.region FROM blobs f
          WHERE f.seed = ?4 AND f.owner_user_id IS NOT NULL AND (SELECT COUNT(*) FROM blobs WHERE region = f.region) < ?5),
         (SELECT region FROM blobs GROUP BY region HAVING COUNT(*) < ?6 ORDER BY region LIMIT 1),
         (SELECT COALESCE(MAX(region) + 1, 0) FROM blobs)
       ), ?3)`,
    )
    .bind(seed, userId, bornAt, friend, cap + FRIENDS_ROOM, cap);
}
// How far past REGION_CAP friends can still squeeze in with each other.
const FRIENDS_ROOM = 50;

// Local tools, only where .dev.vars sets DEV_TOOLS=1: never in production.
const devTools = createMiddleware<{ Bindings: Env; Variables: Vars }>(async (c, next) => {
  if (c.env.DEV_TOOLS !== "1") return c.notFound();
  await next();
});
const allRegions = async (db: D1Database) => (await db.prepare(`SELECT DISTINCT region FROM blobs`).all<{ region: number }>()).results.map((r) => r.region);

// Every region lives forward now, instead of on its next alarm; `ahead` ms
// further still, to play a later step (the load test's clients coming back).
app.post("/__dev/step", devTools, async (c) => {
  const body = await c.req.text();
  const regions = await allRegions(c.env.DB);
  await Promise.all(regions.map((n) => region(c.env, n, "/step", { method: "POST", body: body || "{}" })));
  return c.json({ regions: regions.length });
});

// `count` blobs without accounts, filling new regions (for the load test,
// scripts/load.mjs), or topping up `region` to see an island at its fullest.
app.post("/__dev/populate", devTools, async (c) => {
  const { count, region: into } = await c.req.json<{ count: number; region?: number }>();
  const db = c.env.DB;
  const now = await gardenNow(c.env);
  const first = ((await db.prepare(`SELECT MAX(region) AS n FROM blobs`).first<number | null>("n")) ?? -1) + 1;
  const sexes = ["female", "male", "none"] as const;
  const attractions = ["women", "men", "any"] as const;
  // Names like players pick, free in the garden-wide directory.
  const { results: names } = await db.prepare(`SELECT name_key FROM blobs`).all<{ name_key: string }>();
  const taken = new Set(names.map((r) => r.name_key));
  const freeName = () => {
    for (;;) {
      const name = playerPseudo(randomRng);
      if (taken.has(normalizeSeed(name))) continue;
      taken.add(normalizeSeed(name));
      return name;
    }
  };
  const made = Array.from({ length: count }, (_, i) => {
    const seed = `load-${crypto.randomUUID().slice(0, 13)}`;
    return { seed, name: freeName(), n: into ?? first + Math.floor(i / REGION_CAP), identity: { sex: sexes[i % 3]!, attraction: attractions[(i >> 1) % 3]! } };
  });
  for (let i = 0; i < made.length; i += 100) {
    await db.batch(made.slice(i, i + 100).map((b) => db.prepare(`INSERT INTO blobs (seed, name_key, region, born_at) VALUES (?, ?, ?, ?)`).bind(b.seed, normalizeSeed(b.name), b.n, now)));
  }
  const byRegion = new Map<number, typeof made>();
  for (const b of made) byRegion.set(b.n, [...(byRegion.get(b.n) ?? []), b]);
  for (const [n, blobs] of byRegion) {
    const body = blobs.map((b) => ({ seed: b.seed, ownerUserId: null, name: b.name, country: null, identity: b.identity }));
    const res = await region(c.env, n, "/join", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`region ${n} join failed: ${res.status}`);
  }
  return c.json({ regions: [...byRegion.keys()] });
});

// Anything that breaks is logged whole, for the dashboard's logs (wrangler.toml [observability]).
app.onError((e, c) => {
  console.error(JSON.stringify({ event: "request_failed", method: c.req.method, path: c.req.path, error: String(e), stack: e.stack }));
  return c.json({ error: "internal error" }, 500);
});

export { Region } from "./region";

export default {
  fetch: app.fetch,
  // Regions live on their own alarms. Every 5 minutes (wrangler.toml), this
  // only makes sure each has one: an alarm whose retries all failed is gone,
  // and this sets it again.
  async scheduled(_controller, env) {
    const results = await Promise.allSettled((await allRegions(env.DB)).map((n) => region(env, n, "/wake", { method: "POST" })));
    for (const r of results) if (r.status === "rejected") console.error(JSON.stringify({ event: "wake_failed", error: String(r.reason) }));
  },
} satisfies ExportedHandler<Env>;
