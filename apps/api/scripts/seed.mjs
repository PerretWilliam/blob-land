// Fills a local garden with blobs of every sex and attraction, then runs the
// world step once so they start living. Dev only (DEV_TOOLS=1 in .dev.vars):
// `pnpm --filter @blob-land/api seed [count]`.
const API = process.env.API_URL ?? "http://localhost:8787";
const count = Number(process.argv[2] ?? 16);
const NAMES = ["pip", "mochi", "bramble", "tofu", "juniper", "kiwi", "nimbus", "pebble", "saffron", "fig", "clover", "quill", "maple", "zuzu", "wren", "orzo"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let made = 0;
for (let i = 0; made < count && i < count * 3; i++) {
  const sex = pick(["female", "female", "male", "male", "none"]);
  const attraction = sex === "none" ? "any" : pick(["women", "men", "any"]);
  const pseudo = `${pick(NAMES)}${Math.floor(Math.random() * 1000)}`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pseudo, password: "garden-seed-pass", sex, attraction }),
  });
  if (res.status === 201) {
    made++;
    console.log(`+ ${pseudo.padEnd(12)} ${sex.padEnd(6)} → ${attraction}`);
  } else if (res.status === 429) {
    // Sign-ups are rate limited (20 a minute): wait, then try that one again.
    console.log("… rate limited, waiting 15 s");
    await new Promise((r) => setTimeout(r, 15_000));
    i--;
  } else if (res.status !== 409) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
}
const tick = await fetch(`${API}/__dev/step`, { method: "POST" });
console.log(`${made} blobs created; world step: ${tick.ok ? "ran" : `failed (${tick.status}; is DEV_TOOLS=1 in .dev.vars?)`}`);
