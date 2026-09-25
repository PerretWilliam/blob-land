import { normalizeSeed } from "blobatar";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { hashPassword, verifyPassword } from "./auth";
import type { Env } from "./env";
import { resolvePendingBirths, resolvePendingUnions } from "./garden";
import { cleanName, MAX_NAME_LENGTH, nameTaken } from "./names";
import { familyTree } from "./tree";

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

app.post("/auth/register", rateLimitAuth, async (c) => {
  const body = await c.req.json<{ pseudo?: string; password?: string }>().catch(() => ({}) as { pseudo?: string; password?: string });
  const pseudo = body.pseudo?.trim();
  const password = body.password;
  if (!pseudo || !password || password.length < 8) {
    return c.json({ error: "pseudo and a password of at least 8 characters are required" }, 400);
  }

  const seed = normalizeSeed(pseudo);
  if (await nameTaken(c.env.DB, pseudo)) return c.json({ error: "pseudo already taken" }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (id, pseudo, seed, password_hash, password_salt, visible_in_garden, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, pseudo, seed, hash, salt, now, now)
    .run();

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

app.get("/garden", requireAuth, async (c) => {
  const now = Date.now();
  await resolvePendingUnions(c.env.DB, now);
  await resolvePendingBirths(c.env.DB, now);

  const { results: users } = await c.env.DB.prepare(
    `SELECT id, pseudo, seed FROM users WHERE visible_in_garden = 1`,
  ).all<{ id: string; pseudo: string; seed: string }>();
  const { results: activeUnionMembers } = await c.env.DB.prepare(
    `SELECT user_a, user_b FROM unions WHERE ended_at IS NULL`,
  ).all<{ user_a: string; user_b: string }>();
  const paired = new Set(activeUnionMembers.flatMap((u) => [u.user_a, u.user_b]));

  const { results: children } = await c.env.DB.prepare(`SELECT seed, born_at, name FROM blobs`).all<{
    seed: string;
    born_at: number;
    name: string | null;
  }>();

  // No `state` here: the client is the one with stateAt, and recomputes it
  // itself. This only carries what the client can't derive on its own —
  // who exists, their pseudo, and whether they're in an active union (for
  // the "love" expression override, which depends on server-side pairing).
  return c.json({
    blobs: [
      ...users.map((u) => ({ seed: u.seed, pseudo: u.pseudo, paired: paired.has(u.id) })),
      ...children
        .filter((child) => child.born_at <= now)
        .map((child) => ({ seed: child.seed, pseudo: child.name, paired: false })),
    ],
  });
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
  await resolvePendingUnions(c.env.DB, now);
  await resolvePendingBirths(c.env.DB, now);
  return c.json({ ok: true });
});

// Either parent can rename their child, within the shared pseudo/name namespace.
app.patch("/blobs/:seed/name", requireAuth, async (c) => {
  const seed = c.req.param("seed");
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const name = cleanName(body.name);
  if (!name) return c.json({ error: `a name of 1 to ${MAX_NAME_LENGTH} characters is required` }, 400);

  const parent = await c.env.DB.prepare(
    `SELECT 1 FROM blobs b JOIN unions u ON u.id = b.parent_union_id
     WHERE b.seed = ? AND (u.user_a = ?2 OR u.user_b = ?2)`,
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

// Genealogy is part of the public garden layer, not the private one — no auth.
app.get("/tree/:seed", async (c) => {
  const tree = await familyTree(c.env.DB, c.req.param("seed"));
  return c.json(tree);
});

export default app;
