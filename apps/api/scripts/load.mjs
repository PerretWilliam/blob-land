// The API under load: fills a local garden with `count` blobs (default
// 10 000), lives every region forward once, then asks for /garden
// `requests` times from `concurrency` clients at once, whole and with
// `since`, and reports how long answers took. Dev only, against `pnpm dev`
// with DEV_TOOLS=1 in .dev.vars:
//
//   pnpm --filter @blob-land/api load [count] [concurrency] [requests]
//
// Local numbers: workerd on this machine, not Cloudflare's network. They
// tell whether the work per request fits, not what a player far away waits.
// Keep `requests` modest: the local runtime (wrangler 3) keeps memory from
// every request it serves, even a bare "hello", and dies around 1.5 GB.
const API = process.env.API_URL ?? "http://localhost:8787";
const [count = 10_000, concurrency = 20, requests = 600] = process.argv.slice(2).map(Number);

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res;
}
const timed = async (label, fn) => {
  const t = performance.now();
  const out = await fn();
  console.log(`${label}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  return out;
};

const { token } = await (
  await call("/auth/register", { method: "POST", body: JSON.stringify({ pseudo: `load-${Date.now()}`, password: "load-test-pass" }) })
).json();
const auth = { authorization: `Bearer ${token}` };
await timed(`populate ${count} blobs`, () => call("/__dev/populate", { method: "POST", body: JSON.stringify({ count }) }));
await timed("step every region", () => call("/__dev/step", { method: "POST" }));

const { regions, step } = await (await call("/garden", { headers: auth })).json();
console.log(`${regions.length} regions, ${regions.reduce((s, r) => s + r.blobs, 0)} blobs`);

/** `clients` asking `path()` back to back, `requests` times in all. */
async function hammer(label, path, clients) {
  const times = [];
  let bytes = 0;
  let left = requests;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: clients }, async () => {
      while (left-- > 0) {
        const t = performance.now();
        const body = await (await call(path(), { headers: auth })).text();
        times.push(performance.now() - t);
        bytes += body.length;
      }
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  times.sort((a, b) => a - b);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(0);
  console.log(
    `${label}: ${times.length} answers, ${(times.length / seconds).toFixed(0)}/s, p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, p99 ${at(0.99)} ms, ${(bytes / times.length / 1024).toFixed(0)} KB each`,
  );
}

const anyRegion = () => regions[Math.floor(Math.random() * regions.length)].region;
// One client at a time: how long an answer takes. Then many: how many fit.
for (const [label, clients] of [["one client", 1], [`${concurrency} clients`, concurrency]]) {
  await hammer(`/garden, whole, ${label}`, () => `/garden?region=${anyRegion()}`, clients);
}
// Clients coming back after the next step (5 minutes on): only that step's timeline.
await timed("next step", () => call("/__dev/step", { method: "POST", body: JSON.stringify({ ahead: 5 * 60_000 }) }));
await hammer(`/garden?since=, ${concurrency} clients`, () => `/garden?region=${anyRegion()}&since=${step}`, concurrency);
