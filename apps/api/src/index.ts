import { gardenSize, isAttraction, isCountry, isSex, type Attraction, type Segment, type Sex } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { hashPassword, verifyPassword } from "./auth";
import { gardenNow, timeScale } from "./clock";
import type { Env } from "./env";
import { advanceGarden, newAccountBlob } from "./garden";
import { cleanName, MAX_NAME_LENGTH, nameTaken } from "./names";
import { familyTree, nameOf } from "./tree";

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

type RegisterBody = { pseudo?: string; password?: string; sex?: unknown; attraction?: unknown; country?: unknown };

app.post("/auth/register", rateLimitAuth, async (c) => {
  const body = await c.req.json<RegisterBody>().catch(() => ({}) as RegisterBody);
  const pseudo = body.pseudo?.trim();
  const password = body.password;
  if (!pseudo || !password || password.length < 8) {
    return c.json({ error: "pseudo and a password of at least 8 characters are required" }, 400);
  }
  // Optional: a blob with no sex, drawn to anyone, unless the player says otherwise.
  const [sex, attraction] = [body.sex ?? "none", body.attraction ?? "any"];
  if (!isSex(sex) || !isAttraction(attraction)) return c.json({ error: "sex must be female, male or none; attraction women, men or any" }, 400);
  // Optional too: no country is fine, for those who'd rather stay anonymous.
  const country = body.country ?? null;
  if (country !== null && !isCountry(country)) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);

  const seed = normalizeSeed(pseudo);
  if (await nameTaken(c.env.DB, pseudo)) return c.json({ error: "pseudo already taken" }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, pseudo, seed, password_hash, password_salt, visible_in_garden, country, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(id, pseudo, seed, hash, salt, country, now, now),
    newAccountBlob(c.env.DB, id, seed, { sex, attraction }, await gardenNow(c.env)),
  ]);

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

interface SegmentRow {
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
}

// How long after a breakup both still wear it, in garden time.
const HEARTBREAK = 45 * 60 * 1000;
// How much already-played timeline to send: enough for a smooth pick-up.
const SEGMENT_HISTORY = 15 * 60 * 1000;

// One region of the garden at a time (?region=, else the player's own):
// all a client ever plays back, however big the garden gets.
app.get("/garden", requireAuth, async (c) => {
  const now = await gardenNow(c.env);
  const asked = c.req.query("region");
  if (asked !== undefined && !/^\d{1,9}$/.test(asked)) return c.json({ error: "region must be a non-negative integer" }, 400);
  const home = (await c.env.DB.prepare(`SELECT region FROM blobs WHERE owner_user_id = ?`).bind(c.get("userId")).first<number>("region")) ?? 0;
  const region = asked !== undefined ? Number(asked) : home;
  // Every region and how many live there (hidden players too: the island's
  // size must be the same for everyone), so the player can go and visit.
  const { results: regions } = await c.env.DB.prepare(
    `SELECT region, COUNT(*) AS blobs FROM blobs WHERE born_at <= ? GROUP BY region ORDER BY region`,
  )
    .bind(now)
    .all<{ region: number; blobs: number }>();
  // Children born in the world step's lookahead aren't here yet.
  const { results: blobs } = await c.env.DB.prepare(
    `SELECT b.seed, COALESCE(b.name, u.pseudo) AS pseudo, u.country, b.sex, b.attraction, b.born_at, b.adult_at
     FROM blobs b LEFT JOIN users u ON u.id = b.owner_user_id
     WHERE b.region = ?3 AND b.born_at <= ?1 AND (u.id IS NULL OR u.visible_in_garden = 1 OR u.id = ?2)`,
  )
    .bind(now, c.get("userId"), region)
    .all<{ seed: string; pseudo: string | null; country: string | null; sex: Sex; attraction: Attraction; born_at: number; adult_at: number }>();
  // A union started or ended in the lookahead hasn't happened yet either.
  const { results: unions } = await c.env.DB.prepare(
    `SELECT seed_a, seed_b FROM unions WHERE started_at <= ?1 AND (ended_at IS NULL OR ended_at > ?1)`,
  )
    .bind(now)
    .all<{ seed_a: string; seed_b: string }>();
  const partner = new Map(unions.flatMap((u) => [[u.seed_a, u.seed_b] as const, [u.seed_b, u.seed_a] as const]));
  // Still nursing a broken heart a while after a breakup.
  const { results: splits } = await c.env.DB.prepare(`SELECT seed_a, seed_b FROM unions WHERE ended_at > ?1 - ?2 AND ended_at <= ?1`)
    .bind(now, HEARTBREAK)
    .all<{ seed_a: string; seed_b: string }>();
  const heartbroken = new Set(splits.flatMap((u) => [u.seed_a, u.seed_b]));
  const { results: rows } = await c.env.DB.prepare(
    `SELECT s.* FROM segments s JOIN blobs b ON b.seed = s.seed WHERE b.region = ? AND s.end > ? ORDER BY s.start`,
  )
    .bind(region, now - SEGMENT_HISTORY)
    .all<SegmentRow>();
  const segments = new Map<string, Segment[]>();
  for (const { seed, with_seed, ...r } of rows) {
    segments.set(seed, [...(segments.get(seed) ?? []), { ...r, with: with_seed?.split(",") ?? null }]);
  }

  // Timelines, not states: the client plays the stored segments back itself.
  return c.json({
    now,
    region,
    home,
    regions,
    // The island's side, in cells: every client draws the same one.
    size: gardenSize(regions.find((r) => r.region === region)?.blobs ?? 0),
    // How fast the garden's clock runs: clients play timelines back at this rate.
    rate: timeScale(c.env),
    blobs: blobs.map((b) => ({
      seed: b.seed,
      pseudo: b.pseudo,
      country: b.country,
      sex: b.sex,
      attraction: b.attraction,
      bornAt: b.born_at,
      adultAt: b.adult_at,
      partner: partner.get(b.seed) ?? null,
      heartbroken: heartbroken.has(b.seed),
      segments: segments.get(b.seed) ?? [],
    })),
  });
});

// Where the player says they're from, or null to stop saying.
app.patch("/me/country", requireAuth, async (c) => {
  const body = await c.req.json<{ country?: unknown }>().catch(() => ({}) as { country?: unknown });
  if (body.country !== null && !isCountry(body.country)) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);
  await c.env.DB.prepare(`UPDATE users SET country = ? WHERE id = ?`).bind(body.country, c.get("userId")).run();
  return c.json({ ok: true });
});

app.patch("/me/identity", requireAuth, async (c) => {
  const body = await c.req.json<{ sex?: unknown; attraction?: unknown }>().catch(() => ({}) as { sex?: unknown; attraction?: unknown });
  if (!isSex(body.sex) || !isAttraction(body.attraction)) {
    return c.json({ error: "sex (female, male, none) and attraction (women, men, any) are required" }, 400);
  }
  await c.env.DB.prepare(`UPDATE blobs SET sex = ?, attraction = ? WHERE owner_user_id = ?`)
    .bind(body.sex, body.attraction, c.get("userId"))
    .run();
  return c.json({ ok: true });
});

app.patch("/me/visibility", requireAuth, async (c) => {
  const body = await c.req.json<{ visible?: boolean }>().catch(() => ({}) as { visible?: boolean });
  if (typeof body.visible !== "boolean") return c.json({ error: "visible (boolean) is required" }, 400);
  await c.env.DB.prepare(`UPDATE users SET visible_in_garden = ? WHERE id = ?`)
    .bind(body.visible ? 1 : 0, c.get("userId"))
    .run();
  return c.json({ ok: true });
});

app.patch("/me/ping", requireAuth, async (c) => {
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).bind(now, c.get("userId")).run();
  return c.json({ ok: true });
});

// Either parent can rename their child, within the shared pseudo/name namespace.
app.patch("/blobs/:seed/name", requireAuth, async (c) => {
  const seed = c.req.param("seed");
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const name = cleanName(body.name);
  if (!name) return c.json({ error: `a name of 1 to ${MAX_NAME_LENGTH} characters is required` }, 400);

  const parent = await c.env.DB.prepare(
    `SELECT 1 FROM blobs b
     JOIN unions u ON u.id = b.parent_union_id
     JOIN blobs me ON me.owner_user_id = ?2
     WHERE b.seed = ?1 AND (u.seed_a = me.seed OR u.seed_b = me.seed)`,
  )
    .bind(seed, c.get("userId"))
    .first();
  if (!parent) return c.json({ error: "only a parent can name this blob" }, 403);

  if (await nameTaken(c.env.DB, name, seed)) return c.json({ error: "name already taken" }, 409);
  try {
    await c.env.DB.prepare(`UPDATE blobs SET name = ?, name_key = ? WHERE seed = ?`).bind(name, normalizeSeed(name), seed).run();
  } catch {
    // name_key UNIQUE: another child took it between the check and the write.
    return c.json({ error: "name already taken" }, 409);
  }
  return c.json({ ok: true, name });
});

// How one blob gets on with everyone it has met: public, like the family tree.
// Accounts hidden from the garden stay hidden here too.
app.get("/blobs/:seed/relationships", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.seed, ${nameOf("o")} AS name, r.status, r.friendship, r.romance, r.tension, r.kin, r.meetings, r.last_met_at AS lastMetAt
     FROM relationships r
     JOIN blobs o ON o.seed = CASE WHEN r.seed_a = ?1 THEN r.seed_b ELSE r.seed_a END
     LEFT JOIN users u ON u.id = o.owner_user_id
     WHERE (r.seed_a = ?1 OR r.seed_b = ?1) AND o.born_at <= ?2 AND (u.id IS NULL OR u.visible_in_garden = 1)`,
  )
    .bind(c.req.param("seed"), await gardenNow(c.env))
    .all();
  return c.json({ relationships: results });
});

// Shown only when the blob isn't an account hidden from the garden.
const shown = (alias: string) => `NOT EXISTS (SELECT 1 FROM users WHERE id = ${alias}.owner_user_id AND visible_in_garden = 0)`;
const JOURNAL_SIZE = 60;

// The garden's news, newest first: couples forming and splitting, births, and
// the fights everyone heard about (between blobs who matter to each other, or
// can't stand each other: squabbles between acquaintances are everyday). Only what has happened by now — the world
// step lives a little ahead. Fights are kept as long as interactions are (3 days).
app.get("/garden/journal", requireAuth, async (c) => {
  const now = await gardenNow(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT u.started_at AS at, 'couple' AS kind, a.seed AS a, ${nameOf("a")} AS aName, b.seed AS b, ${nameOf("b")} AS bName, NULL AS c, NULL AS cName
       FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
       WHERE u.started_at <= ?1 AND ${shown("a")} AND ${shown("b")}
       UNION ALL
       SELECT u.ended_at, 'breakup', a.seed, ${nameOf("a")}, b.seed, ${nameOf("b")}, NULL, NULL
       FROM unions u JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
       WHERE u.ended_at <= ?1 AND ${shown("a")} AND ${shown("b")}
       UNION ALL
       SELECT k.born_at, 'birth', a.seed, ${nameOf("a")}, b.seed, ${nameOf("b")}, k.seed, ${nameOf("k")}
       FROM blobs k JOIN unions u ON u.id = k.parent_union_id JOIN blobs a ON a.seed = u.seed_a JOIN blobs b ON b.seed = u.seed_b
       WHERE k.born_at <= ?1 AND ${shown("a")} AND ${shown("b")}
       UNION ALL
       SELECT i.ended_at, 'fight', a.seed, ${nameOf("a")}, b.seed, ${nameOf("b")}, NULL, NULL
       FROM interactions i JOIN blobs a ON a.seed = i.seed_a JOIN blobs b ON b.seed = i.seed_b
       JOIN relationships r ON r.seed_a = i.seed_a AND r.seed_b = i.seed_b
       WHERE i.kind = 'argue' AND i.outcome = 'bad' AND i.ended_at <= ?1 AND ${shown("a")} AND ${shown("b")}
         AND r.status IN ('lovers', 'ex', 'rivals', 'complicated', 'best_friends')
     ) ORDER BY at DESC LIMIT ?2`,
  )
    .bind(now, JOURNAL_SIZE)
    .all();
  return c.json({ now, events: results });
});

// Genealogy is part of the public garden layer, not the private one — no auth.
app.get("/tree/:seed", async (c) => {
  const tree = await familyTree(c.env.DB, c.req.param("seed"), await gardenNow(c.env));
  return c.json(tree);
});

export default {
  fetch: app.fetch,
  // The only writer of the world: every 5 minutes (wrangler.toml), live everyone forward.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(gardenNow(env).then((now) => advanceGarden(env.DB, now)));
  },
} satisfies ExportedHandler<Env>;
