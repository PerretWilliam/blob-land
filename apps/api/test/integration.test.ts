import { firstSegment, PERSONALITY_AXES, randomPersonality, seededRng, type Personality, type Rng } from "@blob-land/sim";
import { and, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { app, clientIp, placeAccount } from "../src/app";
import { gardenNow } from "../src/clock";
import { db } from "../src/db";
import { join as joinGarden, LOOKAHEAD } from "../src/garden";
import { live, stepDue } from "../src/region";
import { blobs, regions, relationships, segments, unions, users } from "../src/schema";

const call = (path: string, init?: RequestInit) => app.request(path, init);

/** Lives every region forward to `until`, as their steps would. */
async function stepAll(now = Date.now(), rng?: Rng, until = now + LOOKAHEAD) {
  for (const { region } of await db.select({ region: regions.region }).from(regions)) await live(region, now, until, rng ?? Math.random);
}

const PASSWORD = "correct horse battery staple";

async function jsonAs<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function register(pseudo: string, identity: { sex?: string; attraction?: string; country?: string; friend?: string; personality?: unknown; gait?: string } = {}) {
  const res = await call("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudo, password: PASSWORD, ...identity }),
  });
  expect(res.status).toBe(201);
  return jsonAs<{ token: string; seed: string }>(res);
}

async function login(pseudo: string) {
  const res = await call("/auth/login", {
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
  blobs: { seed: string; pseudo: string | null; country: string | null; sex: string; attraction: string; personality: Personality; gait: string | null; partner: string | null; segments: { start: number; end: number }[] }[];
}

async function garden(token: string, query = ""): Promise<GardenBody> {
  const res = await call(`/garden${query}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return jsonAs<GardenBody>(res);
}

describe("blob-land API", () => {
  it("registers, logs in, pings, and lists itself in the garden", async () => {
    const { token } = await register("wanderer");
    await login("wanderer");

    const ping = await call("/me/ping", { method: "PATCH", headers: { authorization: `Bearer ${token}` } });
    expect(ping.status).toBe(200);

    // Living from the moment it joins: listed, with a timeline already.
    const after = (await garden(token)).blobs.find((b) => b.pseudo === "wanderer")!;
    expect(after).toMatchObject({ sex: "none", attraction: "any", country: null });
    expect(after.segments.length).toBeGreaterThan(0);
    // Chained: each segment starts where the one before ended.
    for (let i = 1; i < after.segments.length; i++) expect(after.segments[i]!.start).toBe(after.segments[i - 1]!.end);
    expect(after.segments.at(-1)!.end).toBeGreaterThan(Date.now());
  });

  it("answers the health check", async () => {
    expect(await jsonAs(await call("/health"))).toEqual({ ok: true });
  });

  it("keeps each region to itself: stepped when due, and served on its own", async () => {
    const home = await register("homebody");
    // A second region, with one blob in it.
    const populate = await call("/__dev/populate", { method: "POST", body: JSON.stringify({ count: 1 }) });
    expect(await jsonAs<{ regions: number[] }>(populate)).toEqual({ regions: [1] });
    // Both due: one claim steps each once, and then neither is due again for a while.
    await db.update(regions).set({ nextStepAt: 0 });
    expect(await stepDue()).toBe(2);
    expect(await stepDue()).toBe(0);

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
    const bad = await call("/garden?region=-1", { headers: { authorization: `Bearer ${home.token}` } });
    expect(bad.status).toBe(400);
  });

  it("sends only what's new since an earlier answer, and shows hidden players to themselves", async () => {
    const shy = await register("shy");
    const friend = await register("friendly");
    await stepAll();
    const full = await garden(friend.token);
    expect(full.delta).toBe(false);
    const hide = await call("/me/visibility", {
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
    const [{ count }] = (await db.select({ count: regions.population }).from(regions).where(eq(regions.region, 0))) as [{ count: number }];
    const join = (seed: string) =>
      db.transaction(async (tx) => {
        const id = crypto.randomUUID();
        await tx.insert(users).values({ id, pseudo: seed, seed, passwordHash: "x", passwordSalt: "x", lastSeenAt: 0, createdAt: 0 });
        const n = await placeAccount(tx, null, count + 1);
        await joinGarden(tx, n, [{ seed, ownerUserId: id, name: seed, country: null, identity: { sex: "none", attraction: "any" } }], Date.now(), Math.random);
        return n;
      });
    expect(await join("filler")).toBe(0);
    expect(await join("pioneer")).toBe(1);
    // A friend's island wins over the first one with room; an unknown friend is refused.
    const buddy = await register("buddy", { friend: "Pioneer" });
    expect((await garden(buddy.token)).region).toBe(1);
    const lost = await call("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "lonely", password: PASSWORD, friend: "nobody-at-all" }),
    });
    expect(lost.status).toBe(404);
  });

  it("takes a sex and attraction at sign-up, and lets the player change them", async () => {
    const bad = await call("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "oddone", password: PASSWORD, sex: "robot" }),
    });
    expect(bad.status).toBe(400);

    const { token } = await register("roxanne", { sex: "female", attraction: "women" });
    expect((await garden(token)).blobs.find((b) => b.pseudo === "roxanne")).toMatchObject({ sex: "female", attraction: "women" });

    const patch = (body: object) =>
      call("/me/identity", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    expect((await patch({ sex: "male" })).status).toBe(400);
    expect((await patch({ sex: "male", attraction: "any" })).status).toBe(200);
    // The cached view knows the region changed.
    expect((await garden(token)).blobs.find((b) => b.pseudo === "roxanne")).toMatchObject({ sex: "male", attraction: "any" });
  });

  it("shows every blob's character, and lets the player shape their own", async () => {
    const { token } = await register("quill");
    const mine = async () => (await garden(token)).blobs.find((b) => b.pseudo === "quill")!.personality;
    expect(Object.keys(await mine()).sort()).toEqual([...PERSONALITY_AXES].sort());

    const patch = (personality: unknown) => call("/me/personality", { method: "PATCH", headers: as(token), body: JSON.stringify({ personality }) });
    const chosen = Object.fromEntries(PERSONALITY_AXES.map((a, i) => [a, i / 10]));
    expect((await patch({ ...chosen, kindness: 2 })).status).toBe(400);
    expect((await patch({ sociability: 0.5 })).status).toBe(400);
    expect((await patch({ ...chosen, extra: "ignored" })).status).toBe(200);
    expect(await mine()).toEqual(chosen);

    // Joining with the private blob's character keeps it.
    const brought = Object.fromEntries(PERSONALITY_AXES.map((a, i) => [a, 1 - i / 10]));
    const other = await register("ink", { personality: brought });
    expect((await garden(other.token)).blobs.find((b) => b.pseudo === "ink")!.personality).toEqual(brought);
  });

  it("walks as its character does until the player picks a gait", async () => {
    const { token } = await register("strut", { gait: "proud" });
    const gait = async () => (await garden(token)).blobs.find((b) => b.pseudo === "strut")!.gait;
    expect(await gait()).toBe("proud");
    const patch = (gait: unknown) => call("/me/gait", { method: "PATCH", headers: as(token), body: JSON.stringify({ gait }) });
    expect((await patch("moonwalk")).status).toBe(400);
    expect((await patch("shy")).status).toBe(200);
    expect(await gait()).toBe("shy");
    expect((await patch(null)).status).toBe(200);
    expect(await gait()).toBeNull();
    const bad = await call("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pseudo: "plod", password: PASSWORD, gait: "crawl" }) });
    expect(bad.status).toBe(400);
  });

  it("reports pseudo availability, and offers suggestions once taken", async () => {
    const before = await call("/pseudo/brand-new-pseudo");
    expect(before.status).toBe(200);
    expect(await jsonAs<{ available: boolean; suggestions?: string[] }>(before)).toMatchObject({ available: true });

    await register("brand-new-pseudo");

    const after = await call("/pseudo/brand-new-pseudo");
    const afterBody = await jsonAs<{ available: boolean; suggestions: string[] }>(after);
    expect(afterBody.available).toBe(false);
    expect(afterBody.suggestions.length).toBeGreaterThan(0);
    // Each fits the length a pseudo may have (this one is 16 already).
    for (const suggestion of afterBody.suggestions) expect(suggestion.length).toBeLessThanOrEqual(16);

    // Each suggested variant must itself be free to register.
    for (const suggestion of afterBody.suggestions) {
      const check = await call(`/pseudo/${encodeURIComponent(suggestion)}`);
      expect(await jsonAs<{ available: boolean }>(check)).toMatchObject({ available: true });
    }

    // Same seed under different casing/surrounding whitespace must also read
    // as taken — it's normalizeSeed's job (trim + lowercase), not a raw
    // string match.
    const variant = await call(`/pseudo/${encodeURIComponent("  Brand-New-Pseudo  ")}`);
    expect(await jsonAs<{ available: boolean }>(variant)).toMatchObject({ available: false });
  });

  it("tells of a couple and their child in the journal, and exposes it via /tree/:seed", async () => {
    const alice = await register("alice", { sex: "female", attraction: "men" });
    const bob = await register("bob", { sex: "male", attraction: "women" });
    // Whether a couple forms and has a child is a matter of chance (the sim's
    // own tests cover it), so start from the family instead of living it.
    const { child: childSeed } = await family(alice, bob, "Sprig");
    const [a, b] = [alice.seed, bob.seed].sort() as [string, string];

    // Parents and child show up in each other's relationships, as family.
    const rels = await jsonAs<{ relationships: { seed: string; status: string }[] }>(await call(`/blobs/${encodeURIComponent(alice.seed)}/relationships`));
    expect(rels.relationships.find((r) => r.seed === bob.seed)).toBeDefined();

    // The garden's news tells of the couple and the birth, once they've happened.
    await db
      .update(unions)
      .set({ startedAt: Date.now() - 2000 })
      .where(and(eq(unions.seedA, a), eq(unions.seedB, b)));
    const journal = await jsonAs<{ events: { kind: string; c: string | null; aName: string }[] }>(
      await call("/garden/journal", { headers: { Authorization: `Bearer ${alice.token}` } }),
    );
    expect(journal.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["couple", "birth"]));
    expect(journal.events.find((e) => e.kind === "birth")!.c).toBe(childSeed);
    expect(journal.events.find((e) => e.kind === "couple")!.aName).toBeTypeOf("string");

    const tree = await call(`/tree/${encodeURIComponent(alice.seed)}`);
    expect(tree.status).toBe(200);
    const treeBody = await jsonAs<{ children: { seed: string; name: string; born_at: number; parents: { seed: string }[] }[] }>(tree);
    expect(treeBody.children).toHaveLength(1);
    const child = treeBody.children[0]!;
    expect(child.born_at).toBeTypeOf("number");
    expect(child.parents.map((p) => p.seed).sort()).toEqual([alice.seed, bob.seed].sort());

    const childTree = await jsonAs<{ parents: { seed: string }[] | null }>(await call(`/tree/${encodeURIComponent(child.seed)}`));
    expect(childTree.parents!.map((p) => p.seed).sort()).toEqual([alice.seed, bob.seed].sort());

    // Born with a rolled name, in the namespace pseudos use.
    expect(child.name).toMatch(/^[A-Z][a-z]+\d*$/);
    const nameCheck = await call(`/pseudo/${encodeURIComponent(child.name.toLowerCase())}`);
    expect(await jsonAs<{ available: boolean }>(nameCheck)).toMatchObject({ available: false });
    const squatter = await call("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: child.name, password: PASSWORD }),
    });
    expect(squatter.status).toBe(409);

    // Only a parent may rename it, and not to anyone else's pseudo.
    const rename = (token: string, name: string) =>
      call(`/blobs/${encodeURIComponent(child.seed)}/name`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
    const stranger = await register("stranger");
    expect((await rename(stranger.token, "Pebble")).status).toBe(403);
    expect((await rename(alice.token, "bob")).status).toBe(409);
    expect((await rename(alice.token, "  ")).status).toBe(400);
    expect((await rename(alice.token, "Pebble")).status).toBe(200);
    const renamed = await jsonAs<{ name: string }>(await call(`/tree/${encodeURIComponent(child.seed)}`));
    expect(renamed.name).toBe("Pebble");
    // Every blob counted once in its region, children included.
    const [{ counted }] = (await db.execute<{ counted: boolean }>(
      sql`SELECT bool_and(r.population = (SELECT count(*) FROM blobs b WHERE b.region = r.region)) AS counted FROM regions r`,
    )) as unknown as [{ counted: boolean }];
    expect(counted).toBe(true);
  });
});

describe("countries", () => {
  it("takes an optional country, shows it in the garden, and lets it be changed or dropped", async () => {
    const { token, seed } = await register("voyager", { country: "FR" });
    const country = async () => (await garden(token)).blobs.find((b) => b.seed === seed)!.country;
    expect(await country()).toBe("FR");

    const set = (value: unknown) =>
      call("/me/country", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ country: value }),
      });
    expect((await set("JP")).status).toBe(200);
    expect(await country()).toBe("JP");
    expect((await set(null)).status).toBe(200);
    expect(await country()).toBeNull();
    expect((await set("Neverland")).status).toBe(400);

    const bad = await call("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pseudo: "nowhere", password: PASSWORD, country: "XX" }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("the garden clock", () => {
  it("is real time by default, and runs TIME_SCALE times faster when set", async () => {
    expect(Math.abs((await gardenNow()) - Date.now())).toBeLessThan(50);
    const [a, real] = [await gardenNow(60), Date.now()];
    await new Promise((r) => setTimeout(r, 100));
    const b = await gardenNow(60);
    expect(b - a).toBeGreaterThanOrEqual((Date.now() - real) * 60 * 0.8);
  });
});

describe("security", () => {
  it("counts a player by the address the proxy saw, not one they wrote in", async () => {
    const echo = new Hono().get("/", (c) => c.text(clientIp(c as never)));
    // The client wrote the first entry; the proxy appended the last.
    const res = await echo.request("/", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    expect(await res.text()).toBe("203.0.113.9");
  });

  it("checks a pseudo in one go, refuses long ones, and limits how often", async () => {
    const from = { "x-forwarded-for": "198.51.100.7" };
    await register("echo");
    await register("echo2");
    const body = await jsonAs<{ available: boolean; suggestions: string[] }>(await call("/pseudo/echo", { headers: from }));
    expect(body).toMatchObject({ available: false, suggestions: ["echo3", "echo4", "echo5"] });
    expect((await call(`/pseudo/${"a".repeat(17)}`, { headers: from })).status).toBe(400);
    // 60 a minute from one address, then no more.
    const statuses = [];
    for (let i = 0; i < 60; i++) statuses.push((await call(`/pseudo/free${i}`, { headers: from })).status);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
    expect((await call("/pseudo/other", { headers: { "x-forwarded-for": "198.51.100.8" } })).status).toBe(200);
  });

  it("won't start outside dev with a short session secret", async () => {
    const saved = { ...process.env };
    try {
      vi.resetModules();
      Object.assign(process.env, { JWT_SECRET: "change-me", DEV_TOOLS: "" });
      await expect(import("../src/env")).rejects.toThrow(/at least 32 characters/);
      vi.resetModules();
      process.env.JWT_SECRET = "x".repeat(32);
      await expect(import("../src/env")).resolves.toBeDefined();
    } finally {
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  });

  it("caps how many blobs the dev tools make at once", async () => {
    const res = await call("/__dev/populate", { method: "POST", body: JSON.stringify({ count: 1e9 }) });
    expect(res.status).toBe(400);
  });

  it("resets the garden to a seeded blank slate", async () => {
    const res = await call("/__dev/reset", { method: "POST", body: JSON.stringify({ count: 3 }) });
    expect(res.status).toBe(200);
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(blobs)).toHaveLength(3);
    expect((await call("/__dev/reset", { method: "POST", body: JSON.stringify({ count: -1 }) })).status).toBe(400);
  });

  it("refuses a nonsense garden speed", async () => {
    for (const scale of [0, -3, 5000, "fast"]) {
      const res = await call("/__dev/time-scale", { method: "POST", body: JSON.stringify({ scale }) });
      expect(res.status).toBe(400);
    }
  });

  it("steps every region at once when the garden speeds up, before timelines run out", async () => {
    await db.update(regions).set({ nextStepAt: Date.now() + 5 * 60_000 });
    expect((await call("/__dev/time-scale", { method: "POST", body: JSON.stringify({ scale: 1000 }) })).status).toBe(200);
    for (const r of await db.select({ at: regions.nextStepAt }).from(regions)) expect(r.at).toBeLessThanOrEqual(Date.now());
    await call("/__dev/reset", { method: "POST", body: JSON.stringify({ count: 3 }) });
  });
});

/**
 * Two accounts already a couple, with a child, and one meeting between them
 * in the timeline: set down directly, rather than lived until it happens.
 */
async function family(x: { seed: string }, y: { seed: string }, childName: string) {
  const [a, b] = [x.seed, y.seed].sort() as [string, string];
  const [{ region }] = (await db.select({ region: blobs.region }).from(blobs).where(eq(blobs.seed, a))) as [{ region: number }];
  const [now, unionId, child] = [Date.now(), crypto.randomUUID(), `child-${crypto.randomUUID()}`];
  await db.insert(unions).values({ id: unionId, region, seedA: a, seedB: b, startedAt: now - 60_000 });
  const love = { friendship: 80, romance: 90, tension: 0, chemistry: 1, status: "lovers", meetings: 10, lastMetAt: now };
  await db
    .insert(relationships)
    .values({ seedA: a, seedB: b, region, ...love })
    .onConflictDoUpdate({ target: [relationships.seedA, relationships.seedB], set: love });
  await db.insert(blobs).values({
    seed: child,
    name: childName,
    nameKey: childName.toLowerCase(),
    region,
    parentUnionId: unionId,
    bornAt: now - 30_000,
    adultAt: now + DAY,
    sex: "none",
    attraction: "any",
    personality: JSON.stringify(randomPersonality(Math.random)),
    energy: 1,
    mood: 0,
    last: JSON.stringify(firstSegment(now - 30_000, Math.random)),
  });
  const meet = { region, start: now + 0.5, end: now + 60_000, activity: "meet", expression: "happy", x: 0.5, y: 0.5, rng: 1, detail: "chat:good", step: 0 };
  await db.insert(segments).values([
    { seed: a, withSeed: b, ...meet },
    { seed: b, withSeed: a, ...meet },
  ]);
  // Every server's view of the region is stale now.
  await db.update(regions).set({ version: sql`${regions.version} + 1` }).where(eq(regions.region, region));
  return { region, unionId, child };
}

const as = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

describe("a player's own blob", () => {
  it("hides a hidden player from everyone else: in the garden, the family tree and relationships", async () => {
    const ivy = await register("secretivy", { sex: "female", attraction: "men" });
    const oak = await register("openoak", { sex: "male", attraction: "women" });
    const onlooker = await register("onlooker");
    const { child } = await family(ivy, oak, "Sprig");
    await call("/me/visibility", { method: "PATCH", headers: as(ivy.token), body: JSON.stringify({ visible: false }) });

    // Nowhere in what anyone else gets: not as a blob, a partner, or at a meeting.
    const seen = await garden(onlooker.token);
    expect(JSON.stringify(seen)).not.toContain(ivy.seed);
    expect(seen.blobs.find((b) => b.seed === oak.seed)!.partner).toBeNull();
    const tree = async (seed: string, token?: string) =>
      jsonAs<{ name: string | null; partner: { seed: string } | null; parents: { seed: string }[] | null; children: { parents: { seed: string }[] }[] }>(
        await call(`/tree/${encodeURIComponent(seed)}`, token ? { headers: as(token) } : undefined),
      );
    expect(JSON.stringify(await tree(oak.seed))).not.toContain(ivy.seed);
    expect((await tree(child)).parents!.map((p) => p.seed)).toEqual([oak.seed]);
    expect(await tree(ivy.seed)).toMatchObject({ name: null, children: [] });
    const rels = await jsonAs<{ relationships: unknown[] }>(await call(`/blobs/${ivy.seed}/relationships`));
    expect(rels.relationships).toEqual([]);

    // Its own player still sees it whole.
    expect((await garden(ivy.token)).blobs.find((b) => b.seed === ivy.seed)!.partner).toBe(oak.seed);
    const own = await tree(ivy.seed, ivy.token);
    expect(own.partner!.seed).toBe(oak.seed);
    expect(own.children[0]!.parents.map((p) => p.seed).sort()).toEqual([ivy.seed, oak.seed].sort());
  });

  it("breaks a couple up when one of them stops being drawn to the other", async () => {
    const rowan = await register("rowan", { sex: "female", attraction: "men" });
    const birch = await register("birch", { sex: "male", attraction: "women" });
    const { unionId } = await family(rowan, birch, "Twig");
    const change = (identity: object) => call("/me/identity", { method: "PATCH", headers: as(rowan.token), body: JSON.stringify(identity) });
    const pair = async () => {
      const [union] = await db.select().from(unions).where(eq(unions.id, unionId));
      const [a, b] = [rowan.seed, birch.seed].sort() as [string, string];
      const [rel] = await db.select().from(relationships).where(and(eq(relationships.seedA, a), eq(relationships.seedB, b)));
      return { endedAt: union!.endedAt, status: rel!.status, romance: rel!.romance };
    };

    // Still drawn to him: nothing changes between them.
    expect((await change({ sex: "female", attraction: "any" })).status).toBe(200);
    expect(await pair()).toMatchObject({ endedAt: null, status: "lovers", romance: 90 });
    // Not any more: they part, as exes, and the romance is gone.
    expect((await change({ sex: "female", attraction: "women" })).status).toBe(200);
    const after = await pair();
    expect(after).toMatchObject({ status: "ex", romance: 0 });
    expect(after.endedAt).toBeTypeOf("number");
  });

  it("deletes an account for good, with its password, and frees its pseudo", async () => {
    const maple = await register("maple", { sex: "female", attraction: "men" });
    const cedar = await register("cedar", { sex: "male", attraction: "women" });
    const { region, child } = await family(maple, cedar, "Acorn");
    const remove = (password: string) => call("/me", { method: "DELETE", headers: as(maple.token), body: JSON.stringify({ password }) });

    expect((await remove("not the password")).status).toBe(403);
    expect((await remove(PASSWORD)).status).toBe(200);

    const relogin = await call("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pseudo: "maple", password: PASSWORD }) });
    expect(relogin.status).toBe(401);
    expect(await jsonAs<{ available: boolean }>(await call("/pseudo/maple"))).toMatchObject({ available: true });
    // Nothing left that leads back to it: the child keeps its other parent.
    const childTree = await jsonAs<{ parents: { seed: string }[] }>(await call(`/tree/${child}`));
    expect(childTree.parents.map((p) => p.seed)).toEqual([cedar.seed]);
    const left = await db.execute(sql`
      SELECT 1 FROM unions WHERE seed_a = ${maple.seed} OR seed_b = ${maple.seed}
      UNION ALL SELECT 1 FROM relationships WHERE seed_a = ${maple.seed} OR seed_b = ${maple.seed}
      UNION ALL SELECT 1 FROM segments WHERE seed = ${maple.seed} OR with_seed = ${maple.seed}`);
    expect([...left]).toHaveLength(0);
    const [counted] = await db.select({ population: regions.population }).from(regions).where(eq(regions.region, region));
    const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM blobs WHERE region = ${region}`)) as unknown as [{ n: number }];
    expect(counted!.population).toBe(n);

    // Someone new can take the pseudo, with none of the old one's family.
    const again = await register("maple");
    expect((await jsonAs<{ children: unknown[] }>(await call(`/tree/${again.seed}`))).children).toEqual([]);
  });
});
