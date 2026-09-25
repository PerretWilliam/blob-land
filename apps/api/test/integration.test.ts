import { dayKey, hash01, loveChance } from "@blob-land/sim";
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import schemaSql from "../schema.sql?raw";
import { resolvePendingBirths } from "../src/garden";

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

async function register(pseudo: string) {
  const res = await SELF.fetch("https://api.test/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudo, password: PASSWORD }),
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

// The pairing roll (see src/garden.ts) is deterministic per (pseudoA,
// pseudoB, day) — instead of hoping two fixed pseudos happen to fall in love
// today, search for a partner pseudo that deterministically does.
function findLovingPartner(fixedPseudo: string, day: string): string {
  for (let i = 0; i < 500; i++) {
    const candidate = `partner-${i}`;
    const chance = loveChance(fixedPseudo, candidate, day);
    const roll = hash01(`${fixedPseudo}|${candidate}|${day}|pair-roll`);
    if (roll < chance) return candidate;
  }
  throw new Error("no loving partner found in search range");
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

    const garden = await SELF.fetch("https://api.test/garden", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(garden.status).toBe(200);
    const body = await jsonAs<{ blobs: { pseudo: string | null }[] }>(garden);
    expect(body.blobs.some((b) => b.pseudo === "wanderer")).toBe(true);
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

  it("pairs two present users into a union and exposes their child via /tree/:seed once born", async () => {
    const now = Date.now();
    const day = dayKey(now);
    const partnerPseudo = findLovingPartner("alice", day);

    const alice = await register("alice");
    await register(partnerPseudo);
    const aliceLogin = await login("alice");

    // Both were just registered (last_seen_at = now, free of any union), so
    // /garden's lazy resolution should pair them.
    const garden = await SELF.fetch("https://api.test/garden", {
      headers: { authorization: `Bearer ${aliceLogin.token}` },
    });
    expect(garden.status).toBe(200);
    const gardenBody = await jsonAs<{
      blobs: { pseudo: string | null; paired: boolean }[];
    }>(garden);
    const bothBlobs = gardenBody.blobs.filter((b) => b.pseudo === "alice" || b.pseudo === partnerPseudo);
    expect(bothBlobs).toHaveLength(2);
    expect(bothBlobs.every((b) => b.paired)).toBe(true);

    // Force time past the union's 1-7 day birth delay instead of waiting for
    // real time to pass.
    await resolvePendingBirths(env.DB, now + 8 * 24 * 60 * 60 * 1000);

    const tree = await SELF.fetch(`https://api.test/tree/${encodeURIComponent(alice.seed)}`);
    expect(tree.status).toBe(200);
    const treeBody = await jsonAs<{ children: { seed: string }[] }>(tree);
    expect(treeBody.children).toHaveLength(1);

    const childTree = await SELF.fetch(`https://api.test/tree/${encodeURIComponent(treeBody.children[0]!.seed)}`);
    const childTreeBody = await jsonAs<{ parents: { seed: string }[] | null }>(childTree);
    expect(childTreeBody.parents).not.toBeNull();
    expect(childTreeBody.parents!.map((p) => p.seed).sort()).toEqual([alice.seed, partnerPseudo].sort());

    // The child is born with a generated name, in the namespace pseudos use.
    const child = (await jsonAs<{ children: { seed: string; name: string; parents: { seed: string }[] }[]; partner: unknown }>(
      await SELF.fetch(`https://api.test/tree/${encodeURIComponent(alice.seed)}`),
    )).children[0]!;
    expect(child.name).toMatch(/^[A-Z][a-z]+$/);
    expect(child.parents.map((p) => p.seed).sort()).toEqual([alice.seed, partnerPseudo].sort());
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
    expect((await rename(aliceLogin.token, partnerPseudo)).status).toBe(409);
    expect((await rename(aliceLogin.token, "  ")).status).toBe(400);
    expect((await rename(aliceLogin.token, "Pebble")).status).toBe(200);
    const renamed = await jsonAs<{ name: string }>(await SELF.fetch(`https://api.test/tree/${encodeURIComponent(child.seed)}`));
    expect(renamed.name).toBe("Pebble");

    // The union ends at birth, not via a separate endpoint: ended_at must now
    // be set, and both members must be free of any active union.
    const union = await env.DB.prepare(`SELECT ended_at FROM unions WHERE child_traits IS NOT NULL`).first<{
      ended_at: number | null;
    }>();
    expect(union?.ended_at).not.toBeNull();

    const activeUnions = await env.DB.prepare(
      `SELECT id FROM unions
       WHERE ended_at IS NULL
         AND (user_a IN (SELECT id FROM users WHERE pseudo IN ('alice', ?))
           OR user_b IN (SELECT id FROM users WHERE pseudo IN ('alice', ?)))`,
    )
      .bind(partnerPseudo, partnerPseudo)
      .all();
    expect(activeUnions.results).toHaveLength(0);
  });
});
