#!/usr/bin/env node
/*
 * Runs the performance bench (src/bench) in the real app, release build,
 * and reports per scenario: frame rate and stutter (measured in the page),
 * CPU and RAM (sampled from outside: the app plus its WebKit processes).
 *
 *   pnpm bench                 build with VITE_BENCH=1, then run
 *   pnpm bench --skip-build    run the last bench build again
 *   pnpm bench --out file.json also save the report
 *
 * macOS only for now: it reads the app's data folder and WebKit's process names there.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const BINARY = join(APP_DIR, "src-tauri/target/release/blob-land-desktop");
const DATA = join(homedir(), "Library/Application Support/dev.blobland.desktop");
const REPORT = join(DATA, "bench.json");
const TIMEOUT_MS = 180_000;
const EVERY_MS = 500;

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

if (process.platform !== "darwin") {
  console.error("bench.mjs samples RAM and CPU the macOS way; run it on a Mac.");
  process.exit(1);
}
if (!args.includes("--skip-build")) {
  console.log("Building the bench app (release)…");
  execFileSync("pnpm", ["tauri", "build", "--no-bundle"], { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, VITE_BENCH: "1" } });
}
if (!existsSync(BINARY)) throw new Error(`no release build at ${BINARY}`);

/** Every process: pid, resident memory (KB) and CPU time used so far (s). */
function processes() {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,rss=,time=,comm="], { encoding: "utf8" }).trim().split("\n");
  return rows.map((row) => {
    const [pid, rss, time, ...comm] = row.trim().split(/\s+/);
    // [[dd-]hh:]mm:ss.cc
    const seconds = time
      .replace("-", ":")
      .split(":")
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0);
    return { pid: Number(pid), rss: Number(rss), cpu: seconds, comm: comm.join(" ") };
  });
}
const isWebKit = (p) => p.comm.includes("com.apple.WebKit");

// WebKit's helper processes aren't the app's children: ours are the ones that appear once it starts.
const before = new Set(processes().filter(isWebKit).map((p) => p.pid));
mkdirSync(DATA, { recursive: true });
rmSync(REPORT, { force: true });
const launched = Date.now();
const app = spawn(BINARY, [], { stdio: "ignore" });

const samples = [];
let last = null;
const timer = setInterval(() => {
  const ours = processes().filter((p) => p.pid === app.pid || (isWebKit(p) && !before.has(p.pid)));
  const now = { at: Date.now(), rssMB: ours.reduce((s, p) => s + p.rss, 0) / 1024, cpuS: ours.reduce((s, p) => s + p.cpu, 0) };
  // CPU %, from the CPU time used since the last sample (100 = one core).
  if (last) samples.push({ at: now.at, rssMB: now.rssMB, cpu: (100 * (now.cpuS - last.cpuS) * 1000) / (now.at - last.at) });
  last = now;
}, EVERY_MS);

const finished = await new Promise((resolve) => {
  const poll = setInterval(() => {
    const done = existsSync(REPORT) && statSync(REPORT).mtimeMs > launched;
    if (done || Date.now() - launched > TIMEOUT_MS) {
      clearInterval(poll);
      resolve(done);
    }
  }, 1000);
});
clearInterval(timer);
app.kill();
if (!finished) throw new Error("the bench didn't finish in time");

const report = JSON.parse(readFileSync(REPORT, "utf8"));
const round = (v) => Math.round(v * 10) / 10;
const rows = report.results.map((r) => {
  const during = samples.filter((s) => s.at > r.from && s.at <= r.to + EVERY_MS);
  return {
    scenario: r.name,
    fps: r.fps,
    "p95 ms": r.p95Ms,
    "max ms": r.maxMs,
    "jank %": r.jank,
    "CPU %": during.length ? round(during.reduce((s, x) => s + x.cpu, 0) / during.length) : null,
    "RAM MB": during.length ? Math.round(Math.max(...during.map((s) => s.rssMB))) : null,
  };
});
console.log(`\n${report.size}×${report.size} island, ${report.blobs} blobs — peak RAM ${Math.round(Math.max(...samples.map((s) => s.rssMB)))} MB`);
console.table(rows);
if (out) writeFileSync(out, JSON.stringify({ ...report, rows, samples }, null, 2));
