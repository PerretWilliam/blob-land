import { isAttraction, isCountry, isSex, randomRng, type Rng } from "@blob-land/sim";
import { normalizeSeed } from "blobatar";
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { gardenNow, timeScale } from "./clock";
import type { Env } from "./env";
import { gardenView, join, journal, LOOKAHEAD, migrate, regionNumber, relationshipsOf, segmentsOf, step, STEP_EVERY, type Newcomer, type ViewBlob } from "./garden";
import { cleanName, isTaken, MAX_NAME_LENGTH } from "./names";
import { familyTree } from "./tree";

/** What every player of the region is sent, built once per step (see `view`). */
interface View {
  /** Garden time it was built at. */
  at: number;
  /** The step it shows the region after. */
  step: number;
  blobs: ViewBlob[];
  /** Answers already written, by `since` (-1: the whole timeline). */
  answers: Map<number, Answer>;
}

/** An answer's blobs as JSON array items: the visible ones, the same for
 * everyone, and hidden accounts' own, by owner (each sees itself). */
interface Answer {
  shared: string;
  hidden: Map<string, string>;
}

const publicJson = ({ owner: _owner, visible: _visible, ...blob }: ViewBlob) => JSON.stringify(blob);

/**
 * One region of the garden, whole: its blobs and everything they do live in
 * this object's own SQLite, and it lives itself forward on its own alarm.
 * No region shares a database with another, so the garden grows by adding
 * regions. D1 keeps only what they share: accounts and the blob directory.
 * Called through fetch, not RPC: wrangler 3's local dev middleware breaks on
 * RPC calls to a Durable Object.
 */
export class Region extends DurableObject<Env> {
  // One step at a time: an alarm and a step asked for by hand never roll the
  // same stretch of time differently.
  private running: Promise<unknown> = Promise.resolve();
  private cached: View | null = null;
  private readonly app = new Hono<{ Bindings: Env }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage));
    const sql = ctx.storage.sql;
    const app = this.app;

    app.post("/join", async (c) => {
      const body = await c.req.json<Newcomer | Newcomer[]>();
      const now = await gardenNow(this.env);
      this.ctx.storage.transactionSync(() => {
        for (const blob of Array.isArray(body) ? body : [body]) join(sql, blob, now, randomRng);
      });
      this.cached = null;
      // Newcomers have no timeline until a step: live the region now rather
      // than leave them standing still until the alarm. The join itself is
      // done either way; the alarm catches up if this step fails.
      await this.live(now, now + LOOKAHEAD, randomRng).catch((e) =>
        console.error(JSON.stringify({ event: "step_failed", region: regionNumber(sql), error: String(e), stack: (e as Error).stack })),
      );
      return c.body(null, 204);
    });

    // The region as its players play it back. `since` (a step number from an
    // earlier answer) sends only the timeline written after it.
    app.get("/garden", async (c) => {
      const view = this.view(await gardenNow(this.env));
      const since = Number(c.req.query("since") ?? NaN);
      const delta = Number.isInteger(since) && since >= 0 && since <= view.step;
      const answer = this.answer(view, delta ? since : -1);
      const blobs = [answer.shared, answer.hidden.get(c.req.query("viewer") ?? "")].filter(Boolean).join(",");
      return c.body(`{"step":${view.step},"delta":${delta},"blobs":[${blobs}]}`, 200, { "content-type": "application/json" });
    });

    // What the player owns about their blob: who they are, where they're from, whether they show.
    app.patch("/member", async (c) => {
      const body = await c.req.json<{ owner: string; sex?: unknown; attraction?: unknown; country?: unknown; visible?: unknown }>();
      const sets: [string, unknown][] = [];
      if (body.sex !== undefined || body.attraction !== undefined) {
        if (!isSex(body.sex) || !isAttraction(body.attraction)) return c.json({ error: "sex (female, male, none) and attraction (women, men, any) are required" }, 400);
        sets.push(["sex", body.sex], ["attraction", body.attraction]);
      }
      if (body.country !== undefined) {
        if (body.country !== null && !isCountry(body.country)) return c.json({ error: "country must be an ISO 3166-1 alpha-2 code, or null" }, 400);
        sets.push(["country", body.country]);
      }
      if (body.visible !== undefined) {
        if (typeof body.visible !== "boolean") return c.json({ error: "visible (boolean) is required" }, 400);
        sets.push(["visible", body.visible ? 1 : 0]);
      }
      if (sets.length === 0) return c.json({ error: "nothing to change" }, 400);
      const { rowsWritten } = sql.exec(
        `UPDATE blobs SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE owner_user_id = ?`,
        ...sets.map(([, v]) => v as SqlStorageValue),
        body.owner,
      );
      if (rowsWritten === 0) return c.json({ error: "no blob here for that account" }, 404);
      this.cached = null;
      return c.json({ ok: true });
    });

    // Either parent can rename their child, within the garden-wide namespace.
    app.patch("/name", async (c) => {
      const body = await c.req.json<{ seed: string; name?: unknown; viewer: string }>();
      const name = cleanName(body.name);
      if (!name) return c.json({ error: `a name of 1 to ${MAX_NAME_LENGTH} characters is required` }, 400);
      const parent = sql
        .exec(
          `SELECT 1 FROM blobs b
           JOIN unions u ON u.id = b.parent_union_id
           JOIN blobs me ON me.owner_user_id = ?2
           WHERE b.seed = ?1 AND (u.seed_a = me.seed OR u.seed_b = me.seed)`,
          body.seed,
          body.viewer,
        )
        .toArray();
      if (parent.length === 0) return c.json({ error: "only a parent can name this blob" }, 403);
      try {
        await this.env.DB.prepare(`UPDATE blobs SET name_key = ? WHERE seed = ?`).bind(normalizeSeed(name), body.seed).run();
      } catch (e) {
        if (isTaken(e)) return c.json({ error: "name already taken" }, 409);
        throw e;
      }
      sql.exec(`UPDATE blobs SET name = ? WHERE seed = ?`, name, body.seed);
      this.cached = null;
      return c.json({ ok: true, name });
    });

    app.get("/relationships/:seed", async (c) => c.json({ relationships: relationshipsOf(sql, c.req.param("seed"), await gardenNow(this.env)) }));
    app.get("/tree/:seed", async (c) => c.json(familyTree(sql, c.req.param("seed"), await gardenNow(this.env))));
    app.get("/journal", async (c) => {
      const now = await gardenNow(this.env);
      return c.json({ now, events: journal(sql, now) });
    });

    // Lives the region forward now (and `ahead` ms further), without waiting
    // for its alarm: dev tools only (see index.ts).
    app.post("/step", async (c) => {
      const { ahead = 0 } = await c.req.json<{ ahead?: number }>().catch(() => ({}) as { ahead?: number });
      const now = await gardenNow(this.env);
      await this.live(now, now + LOOKAHEAD + ahead, randomRng);
      return c.body(null, 204);
    });

    // Every request makes sure the alarm is set (see fetch): this one does only that.
    app.post("/wake", (c) => c.body(null, 204));

    app.onError((e, c) => {
      console.error(JSON.stringify({ event: "region_failed", region: regionNumber(sql), path: c.req.path, error: String(e), stack: e.stack }));
      return c.json({ error: "internal error" }, 500);
    });
  }

  async fetch(request: Request): Promise<Response> {
    // The first request names the region (idFromName can't be read back).
    const region = request.headers.get("x-region");
    if (region !== null) this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO meta (id, region) VALUES (1, ?)`, Number(region));
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + this.every());
    return this.app.fetch(request, this.env);
  }

  /**
   * Every STEP_EVERY, the region lives itself forward. A step that throws is
   * retried by the runtime (with backoff); if it keeps failing, the cron's
   * watchdog (index.ts) sets the alarm again.
   */
  async alarm(): Promise<void> {
    const now = await gardenNow(this.env);
    try {
      await this.live(now, now + LOOKAHEAD, randomRng);
    } catch (e) {
      console.error(JSON.stringify({ event: "step_failed", region: regionNumber(this.ctx.storage.sql), error: String(e), stack: (e as Error).stack }));
      throw e;
    }
    await this.ctx.storage.setAlarm(Date.now() + this.every());
  }

  /** Lives the region forward to `until`, after any step already running. Tests call it with their own rng. */
  live(now: number, until: number, rng: Rng): Promise<boolean> {
    const run = this.running.then(() => step(this.ctx.storage, this.env.DB, now, rng, until));
    this.running = run.catch(() => {});
    return run.finally(() => (this.cached = null));
  }

  /** The alarm's period in real time: STEP_EVERY of garden time. */
  private every() {
    return Math.max(1000, STEP_EVERY / timeScale(this.env));
  }

  /** The cached view, rebuilt after a step or a change, or when it's a step old (an alarm running late). */
  private view(now: number): View {
    if (this.cached && now - this.cached.at < STEP_EVERY) return this.cached;
    const { sql } = this.ctx.storage;
    const step = sql.exec<{ step: number }>(`SELECT step FROM meta`).one().step;
    this.cached = { at: now, step, blobs: gardenView(sql, now), answers: new Map() };
    return this.cached;
  }

  /**
   * The view's blobs with the whole timeline (`since` -1), or only what was
   * written after step `since`. Players come back every minute or so and
   * steps are five apart, so nearly all ask for one of the last couple of
   * steps: those answers are written once and kept; older ones aren't, so
   * no one can fill memory by asking for every step there ever was.
   */
  private answer(view: View, since: number): Answer {
    const kept = view.answers.get(since);
    if (kept) return kept;
    const segments = since < 0 ? null : segmentsOf(this.ctx.storage.sql, view.at, since);
    const json = (b: ViewBlob) => publicJson(segments ? { ...b, segments: segments.get(b.seed) ?? [] } : b);
    const answer = {
      shared: view.blobs.filter((b) => b.visible).map(json).join(","),
      hidden: new Map(view.blobs.filter((b) => !b.visible && b.owner).map((b) => [b.owner!, json(b)] as const)),
    };
    if (since < 0 || since >= view.step - 2) view.answers.set(since, answer);
    return answer;
  }
}

/** A request to `region`'s object: `path` as the object routes it. */
export function region(env: Env, n: number, path: string, init: RequestInit = {}): Promise<Response> {
  const stub = env.REGION.get(env.REGION.idFromName(String(n)));
  const headers = new Headers(init.headers);
  headers.set("x-region", String(n));
  if (init.body) headers.set("content-type", "application/json");
  return stub.fetch(`https://region${path}`, { ...init, headers });
}
