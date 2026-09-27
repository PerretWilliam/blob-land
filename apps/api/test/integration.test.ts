import { seededRng } from "@blob-land/sim";
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import schemaSql from "../schema.sql?raw";
import { gardenNow } from "../src/clock";
import { advanceGarden } from "../src/garden";

beforeAll(async () => {
  // Strip `-- comment` text first: a comment can itself contain a `;` (see
  // schema.sql), which would otherwise split a statement in half.
  const withoutComments = schemaSql.replace(/--.*$/gm, "");
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
});

const PASSWORD = "correct horse battery staple";

async function jsonAs<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function register(pseudo: string, identity: { sex?: string; attraction?: string } = {}) {
  const res = await SELF.fetch("https://api.test/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudo, password: PASSWORD, ...identity }),
  });
  expect(res.status).toBe(201);
  return jsonAs<{ token: string; seed: string }>(res);
}

async function login(pseudo: string) {
  const res = await SELF.fetch("https://api.test/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudo, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return jsonAs<{ token: string; seed: string }>(res);
}

const DAY = 24 * 60 * 60 * 1000;

interface GardenBody {
  blobs: { seed: string; pseudo: string | null; sex: string; attraction: string; partner: string | null; segments: { start: number; end: number }[] }[];
}

async function garden(token: string): Promise<GardenBody> {
  const res = await SELF.fetch("https://api.test/garden", { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return jsonAs<GardenBody>(res);
}

describe("blob-land API", () => {
  it("registers, logs in, pings, and lists itself in the garden", async () => {
    const { token } = await register("wanderer");
    await login("wanderer");

    const ping = await SELF.fetch("https://api.test/me/ping", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ping.status).toBe(200);

    // Registered but not lived yet: listed, with no timeline until the world step runs.
    const before = (await garden(token)).blobs.find((b) => b.pseudo === "wanderer")!;
    expect(before).toMatchObject({ sex: "none", attraction: "any", segments: [] });

    await advanceGarden(env.DB, Date.now());
    const after = (await garden(token)).blobs.find((b) => b.pseudo === "wanderer")!;
    expect(after.segments.length).toBeGreaterThan(0);
    // Chained: each segment starts where the one before ended.
    for (let i = 1; i < after.segments.length; i++) expect(after.segments[i]!.start).toBe(after.segments[i - 1]!.end);
    expect(after.segments.at(-1)!.end).toBeGreaterThan(Date.now());
  });

  it("takes a sex and attraction at sign-up, and lets the player change them", async () => {
    const bad = await SELF.fetch("https://api.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "oddone", password: PASSWORD, sex: "robot" }),
    });
    expect(bad.status).toBe(400);

    const { token } = await register("roxanne", { sex: "female", attraction: "women" });
    expect((await garden(token)).blobs.find((b) => b.pseudo === "roxanne")).toMatchObject({ sex: "female", attraction: "women" });

    const patch = (body: object) =>
      SELF.fetch("https://api.test/me/identity", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    expect((await patch({ sex: "male" })).status).toBe(400);
    expect((await patch({ sex: "male", attraction: "any" })).status).toBe(200);
    expect((await garden(token)).blobs.find((b) => b.pseudo === "roxanne")).toMatchObject({ sex: "male", attraction: "any" });
  });

  it("reports pseudo availability, and offers suggestions once taken", async () => {
    const before = await SELF.fetch("https://api.test/pseudo/brand-new-pseudo");
    expect(before.status).toBe(200);
    expect(await jsonAs<{ available: boolean; suggestions?: string[] }>(before)).toMatchObject({ available: true });

    await register("brand-new-pseudo");

    const after = await SELF.fetch("https://api.test/pseudo/brand-new-pseudo");
    const afterBody = await jsonAs<{ available: boolean; suggestions: string[] }>(after);
    expect(afterBody.available).toBe(false);
    expect(afterBody.suggestions.length).toBeGreaterThan(0);

    // Each suggested variant must itself be free to register.
    for (const suggestion of afterBody.suggestions) {
      const check = await SELF.fetch(`https://api.test/pseudo/${encodeURIComponent(suggestion)}`);
      expect(await jsonAs<{ available: boolean }>(check)).toMatchObject({ available: true });
    }

    // Same seed under different casing/surrounding whitespace must also read
    // as taken — it's normalizeSeed's job (trim + lowercase), not a raw
    // string match.
    const variant = await SELF.fetch(`https://api.test/pseudo/${encodeURIComponent("  Brand-New-Pseudo  ")}`);
    expect(await jsonAs<{ available: boolean }>(variant)).toMatchObject({ available: false });
  });

  it("lets two blobs fall for each other, have a child, and exposes it via /tree/:seed", async () => {
    const alice = await register("alice", { sex: "female", attraction: "men" });
    const bob = await register("bob", { sex: "male", attraction: "women" });
    // Head start: they already adore each other, so this doesn't take a simulated year.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO relationships (seed_a, seed_b, friendship, romance, tension, chemistry, status, meetings, last_met_at)
       VALUES (?, ?, 80, 90, 0, 1, 'crush', 10, ?)`,
    )
      .bind(alice.seed, bob.seed, Date.now())
      .run();

    // Live the garden forward a day at a time until a child is born.
    const rng = seededRng(7);
    const start = Date.now();
    let childSeed: string | undefined;
    for (let d = 1; d <= 60 && !childSeed; d++) {
      await advanceGarden(env.DB, start + d * DAY, rng, start + d * DAY);
      childSeed = (await env.DB.prepare(`SELECT seed FROM blobs WHERE parent_union_id IS NOT NULL LIMIT 1`).first<{ seed: string }>())?.seed;
    }
    expect(childSeed).toBeDefined();

    const union = await env.DB.prepare(`SELECT seed_a, seed_b FROM unions LIMIT 1`).first<{ seed_a: string; seed_b: string }>();
    expect([union!.seed_a, union!.seed_b].sort()).toEqual([alice.seed, bob.seed].sort());
    // Parents and child show up in each other's relationships, as family.
    const rels = await jsonAs<{ relationships: { seed: string; status: string }[] }>(
      await SELF.fetch(`https://api.test/blobs/${encodeURIComponent(alice.seed)}/relationships`),
    );
    expect(rels.relationships.find((r) => r.seed === bob.seed)).toBeDefined();

    const kin = await env.DB.prepare(`SELECT kin FROM relationships WHERE (seed_a = ?1 OR seed_b = ?1) AND kin = 'parent'`).bind(childSeed).all();
    expect(kin.results).toHaveLength(2);

    // /tree hides blobs born "in the future" (the step lives ahead of now); ask as of then.
    await env.DB.prepare(`UPDATE blobs SET born_at = ? WHERE seed = ?`).bind(Date.now() - 1000, childSeed).run();

    const tree = await SELF.fetch(`https://api.test/tree/${encodeURIComponent(alice.seed)}`);
    expect(tree.status).toBe(200);
    const treeBody = await jsonAs<{ children: { seed: string; name: string; parents: { seed: string }[] }[] }>(tree);
    expect(treeBody.children).toHaveLength(1);
    const child = treeBody.children[0]!;
    expect(child.parents.map((p) => p.seed).sort()).toEqual([alice.seed, bob.seed].sort());

    const childTree = await jsonAs<{ parents: { seed: string }[] | null }>(await SELF.fetch(`https://api.test/tree/${encodeURIComponent(child.seed)}`));
    expect(childTree.parents!.map((p) => p.seed).sort()).toEqual([alice.seed, bob.seed].sort());

    // Born with a rolled name, in the namespace pseudos use.
    expect(child.name).toMatch(/^[A-Z][a-z]+\d*$/);
    const nameCheck = await SELF.fetch(`https://api.test/pseudo/${encodeURIComponent(child.name.toLowerCase())}`);
    expect(await jsonAs<{ available: boolean }>(nameCheck)).toMatchObject({ available: false });
    const squatter = await SELF.fetch("https://api.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: child.name, password: PASSWORD }),
    });
    expect(squatter.status).toBe(409);

    // Only a parent may rename it, and not to anyone else's pseudo.
    const rename = (token: string, name: string) =>
      SELF.fetch(`https://api.test/blobs/${encodeURIComponent(child.seed)}/name`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
    const stranger = await register("stranger");
    expect((await rename(stranger.token, "Pebble")).status).toBe(403);
    expect((await rename(alice.token, "bob")).status).toBe(409);
    expect((await rename(alice.token, "  ")).status).toBe(400);
    expect((await rename(alice.token, "Pebble")).status).toBe(200);
    const renamed = await jsonAs<{ name: string }>(await SELF.fetch(`https://api.test/tree/${encodeURIComponent(child.seed)}`));
    expect(renamed.name).toBe("Pebble");
  });
});

describe("the garden clock", () => {
  it("is real time by default, and runs TIME_SCALE times faster when set", async () => {
    expect(Math.abs((await gardenNow(env)) - Date.now())).toBeLessThan(50);
    const fast = { ...env, TIME_SCALE: "60" };
    const [a, real] = [await gardenNow(fast), Date.now()];
    await new Promise((r) => setTimeout(r, 100));
    const b = await gardenNow(fast);
    expect(b - a).toBeGreaterThanOrEqual((Date.now() - real) * 60 * 0.8);
  });
});
