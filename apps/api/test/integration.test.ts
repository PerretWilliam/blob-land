import { seededRng, type Rng } from "@blob-land/sim";
import { createScheduledController, env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { gardenNow } from "../src/clock";
import { LOOKAHEAD } from "../src/garden";
import worker, { placeAccount } from "../src/index";
import type { Region } from "../src/region";

const stub = (n: number) => env.REGION.get(env.REGION.idFromName(String(n)));
/** Runs `fn` on region `n`'s own SQLite. */
const inRegion = <T>(n: number, fn: (sql: SqlStorage) => T) => runInDurableObject(stub(n), (_: Region, state) => fn(state.storage.sql));
/** Lives every region forward to `until`, as their alarms would. */
async function stepAll(now = Date.now(), rng?: Rng, until = now + LOOKAHEAD) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT region FROM blobs`).all<{ region: number }>();
  for (const { region } of results) await runInDurableObject(stub(region), (r: Region) => r.live(now, until, rng ?? Math.random));
}

const PASSWORD = "correct horse battery staple";

async function jsonAs<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function register(pseudo: string, identity: { sex?: string; attraction?: string; country?: string; friend?: string } = {}) {
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
  step: number;
  delta: boolean;
  region: number;
  home: number;
  size: number;
  regions: { region: number; blobs: number }[];
  blobs: { seed: string; pseudo: string | null; country: string | null; sex: string; attraction: string; partner: string | null; segments: { start: number; end: number }[] }[];
}

async function garden(token: string, query = ""): Promise<GardenBody> {
  const res = await SELF.fetch(`https://api.test/garden${query}`, { headers: { authorization: `Bearer ${token}` } });
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
    expect(before).toMatchObject({ sex: "none", attraction: "any", country: null, segments: [] });

    await stepAll();
    const after = (await garden(token)).blobs.find((b) => b.pseudo === "wanderer")!;
    expect(after.segments.length).toBeGreaterThan(0);
    // Chained: each segment starts where the one before ended.
    for (let i = 1; i < after.segments.length; i++) expect(after.segments[i]!.start).toBe(after.segments[i - 1]!.end);
    expect(after.segments.at(-1)!.end).toBeGreaterThan(Date.now());
  });

  it("keeps each region to itself: lived on its own alarm, and served on its own", async () => {
    const home = await register("homebody");
    // A second region, with one blob in it.
    const populate = await SELF.fetch("https://api.test/__dev/populate", { method: "POST", body: JSON.stringify({ count: 1 }) });
    expect(await jsonAs<{ regions: number[] }>(populate)).toEqual({ regions: [1] });
    // Each region lives on its own alarm.
    for (const n of [0, 1]) expect(await runDurableObjectAlarm(stub(n))).toBe(true);

    const mine = await garden(home.token);
    const theirs = await garden(home.token, "?region=1");
    expect(mine.blobs.map((b) => b.seed)).toContain(home.seed);
    expect(theirs.blobs).toHaveLength(1);
    expect(mine.blobs.map((b) => b.seed)).not.toContain(theirs.blobs[0]!.seed);
    // Both regions were lived.
    expect(theirs.blobs[0]!.segments.length).toBeGreaterThan(0);
    expect(mine.blobs.find((b) => b.seed === home.seed)!.segments.length).toBeGreaterThan(0);
    // Visiting: still home is home, and every region is listed with its island.
    expect(theirs).toMatchObject({ region: 1, home: 0, size: 24 });
    expect(theirs.regions.map((r) => r.region)).toEqual([0, 1]);
    expect(theirs.regions[1]!.blobs).toBe(1);
    // A region no one lives in is empty; nonsense is refused.
    expect((await garden(home.token, "?region=7")).blobs).toEqual([]);
    const bad = await SELF.fetch("https://api.test/garden?region=-1", { headers: { authorization: `Bearer ${home.token}` } });
    expect(bad.status).toBe(400);

    // An alarm whose retries all failed is gone: the cron sets it again.
    await runInDurableObject(stub(1), (_: Region, state) => state.storage.deleteAlarm());
    await worker.scheduled(createScheduledController(), env);
    expect(await runInDurableObject(stub(1), (_: Region, state) => state.storage.getAlarm())).not.toBeNull();
  });

  it("sends only what's new since an earlier answer, and shows hidden players to themselves", async () => {
    const shy = await register("shy");
    const friend = await register("friendly");
    await stepAll();
    const full = await garden(friend.token);
    expect(full.delta).toBe(false);
    const hide = await SELF.fetch("https://api.test/me/visibility", {
      method: "PATCH",
      headers: { authorization: `Bearer ${shy.token}`, "content-type": "application/json" },
      body: JSON.stringify({ visible: false }),
    });
    expect(hide.status).toBe(200);
    expect((await garden(friend.token)).blobs.map((b) => b.seed)).not.toContain(shy.seed);
    expect((await garden(shy.token)).blobs.map((b) => b.seed)).toContain(shy.seed);

    // Nothing lived since: the same blobs, no timeline to send.
    const same = await garden(friend.token, `?since=${full.step}`);
    expect(same).toMatchObject({ delta: true, step: full.step });
    expect(same.blobs.every((b) => b.segments.length === 0)).toBe(true);
    // A step later: only the new stretch, picking up where the last one ended.
    const last = full.blobs.find((b) => b.seed === friend.seed)!.segments.at(-1)!;
    await stepAll(Date.now(), undefined, last.end + LOOKAHEAD);
    const next = await garden(friend.token, `?since=${full.step}`);
    expect(next.step).toBe(full.step + 1);
    const fresh = next.blobs.find((b) => b.seed === friend.seed)!.segments;
    expect(fresh[0]!.start).toBe(last.end);
    // A step number from the future (a region restored from backup) gets everything again.
    expect((await garden(friend.token, `?since=${next.step + 5}`)).delta).toBe(false);
  });

  it("sends new accounts to the first region with room, and opens the next when all are full", async () => {
    const { region } = await garden((await register("newcomer")).token);
    expect(region).toBe(0);
    // With room for one more, the next account still lands in region 0; once
    // it's full, the one after opens region 1.
    const count = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM blobs WHERE region = 0`).first<number>("n"))!;
    const join = async (seed: string) => {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id, pseudo, seed, password_hash, password_salt, last_seen_at, created_at) VALUES (?, ?, ?, 'x', 'x', 0, 0)`).bind(id, seed, seed),
        placeAccount(env.DB, id, seed, Date.now(), null, count + 1),
      ]);
      return env.DB.prepare(`SELECT region FROM blobs WHERE seed = ?`).bind(seed).first<number>("region");
    };
    expect(await join("filler")).toBe(0);
    expect(await join("pioneer")).toBe(1);
    // A friend's island wins over the first one with room; an unknown friend is refused.
    const buddy = await register("buddy", { friend: "Pioneer" });
    expect((await garden(buddy.token)).region).toBe(1);
    const lost = await SELF.fetch("https://api.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "lonely", password: PASSWORD, friend: "nobody-at-all" }),
    });
    expect(lost.status).toBe(404);
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
    const [a, b] = [alice.seed, bob.seed].sort();
    await inRegion(0, (sql) =>
      sql.exec(
        `INSERT OR REPLACE INTO relationships (seed_a, seed_b, friendship, romance, tension, chemistry, status, meetings, last_met_at)
         VALUES (?, ?, 80, 90, 0, 1, 'crush', 10, ?)`,
        a!,
        b!,
        Date.now(),
      ),
    );

    // Live the garden forward a day at a time until a child is born.
    const rng = seededRng(7);
    const start = Date.now();
    let childSeed: string | undefined;
    for (let d = 1; d <= 60 && !childSeed; d++) {
      await stepAll(start + d * DAY, rng, start + d * DAY);
      childSeed = await inRegion(0, (sql) => sql.exec<{ seed: string }>(`SELECT seed FROM blobs WHERE parent_union_id IS NOT NULL LIMIT 1`).toArray()[0]?.seed);
    }
    expect(childSeed).toBeDefined();

    const union = await inRegion(0, (sql) => sql.exec<{ seed_a: string; seed_b: string }>(`SELECT seed_a, seed_b FROM unions LIMIT 1`).one());
    expect([union!.seed_a, union!.seed_b].sort()).toEqual([alice.seed, bob.seed].sort());
    // Parents and child show up in each other's relationships, as family.
    const rels = await jsonAs<{ relationships: { seed: string; status: string }[] }>(
      await SELF.fetch(`https://api.test/blobs/${encodeURIComponent(alice.seed)}/relationships`),
    );
    expect(rels.relationships.find((r) => r.seed === bob.seed)).toBeDefined();

    const kin = await inRegion(0, (sql) => sql.exec(`SELECT kin FROM relationships WHERE (seed_a = ?1 OR seed_b = ?1) AND kin = 'parent'`, childSeed!).toArray());
    expect(kin).toHaveLength(2);

    // /tree hides blobs born "in the future" (the step lives ahead of now); ask as of then.
    await inRegion(0, (sql) => sql.exec(`UPDATE blobs SET born_at = ? WHERE seed = ?`, Date.now() - 1000, childSeed!));

    // The garden's news tells of the couple and the birth, once they've happened.
    await inRegion(0, (sql) => sql.exec(`UPDATE unions SET started_at = ?`, Date.now() - 2000));
    const journal = await jsonAs<{ events: { kind: string; c: string | null }[] }>(
      await SELF.fetch("https://api.test/garden/journal", { headers: { Authorization: `Bearer ${alice.token}` } }),
    );
    expect(journal.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["couple", "birth"]));
    expect(journal.events.find((e) => e.kind === "birth")!.c).toBe(childSeed);

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

describe("countries", () => {
  it("takes an optional country, shows it in the garden, and lets it be changed or dropped", async () => {
    const { token, seed } = await register("voyager", { country: "FR" });
    const country = async () => (await garden(token)).blobs.find((b) => b.seed === seed)!.country;
    expect(await country()).toBe("FR");

    const set = (value: unknown) =>
      SELF.fetch("https://api.test/me/country", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ country: value }),
      });
    expect((await set("JP")).status).toBe(200);
    expect(await country()).toBe("JP");
    expect((await set(null)).status).toBe(200);
    expect(await country()).toBeNull();
    expect((await set("Neverland")).status).toBe(400);

    const bad = await SELF.fetch("https://api.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "nowhere", password: PASSWORD, country: "XX" }),
    });
    expect(bad.status).toBe(400);
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
