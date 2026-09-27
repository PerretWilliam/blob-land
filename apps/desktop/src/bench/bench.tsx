/*
 * The performance bench: a big garden island full of blobs, put through the
 * same scripted moves every run (sitting still, zooming, following a blob,
 * panning fast, by day and by night) while every frame is timed.
 *
 * Opened with `#bench` on the dev server, or built into the app with
 * VITE_BENCH=1 (see scripts/bench.mjs, which also reads RAM and CPU).
 * `?size=` and `?n=` change the island and the crowd; `?idle` shows it
 * without playing the moves, to look around by hand (`?night` by night,
 * `?rate=20` with garden time running 20 times faster).
 */
import { seededRng, type Segment } from "@blob-land/sim";
import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useRef, useState } from "react";
import { expressionNamed, Scene, type SceneBlob } from "@/components/scene";
import { useGardenIsland } from "@/lib/use-garden-island";

const params = new URLSearchParams(location.search);
// Also settable when building the bench app (VITE_BENCH_SIZE, VITE_BENCH_N), which has no URL to pass them in.
const SIZE = Number(params.get("size") ?? import.meta.env.VITE_BENCH_SIZE ?? 128);
const COUNT = Number(params.get("n") ?? import.meta.env.VITE_BENCH_N ?? 450);
const IDLE = params.has("idle");
// Garden time's pace, like the API's TIME_SCALE in dev.
const RATE = Number(params.get("rate") ?? 1);

const HOUR = 60 * 60 * 1000;
// Garden times the bench plays at: noon, and deep in the night (UTC, like daylight()).
const NOON = Date.UTC(2026, 0, 1, 12);
const NIGHT = Date.UTC(2026, 0, 2, 1);
const EXPRESSIONS = ["idle", "happy", "sleepy", "love", "thinking", "wink"];

/** Everyone wandering the island around both times, the same every run. */
function crowd(): SceneBlob[] {
  const rng = seededRng(7);
  return Array.from({ length: COUNT }, (_, i) => {
    const segments: Segment[] = [];
    for (const base of [NOON, NIGHT]) {
      for (let t = base - HOUR; t < base + 2 * HOUR; t += 10 * 60 * 1000) {
        const expression = EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)]!;
        segments.push({ start: t, end: t + 10 * 60 * 1000, activity: rng() < 0.8 ? "explore" : "rest", expression, x: rng(), y: rng(), rng: Math.floor(rng() * 2 ** 31), with: null, detail: null });
      }
    }
    return {
      seed: `bench-${i}`,
      label: `blob ${i}`,
      segments,
      expression: expressionNamed(segments[0]!.expression),
      activity: "explore",
      sex: (["female", "male", "none"] as const)[i % 3]!,
      attraction: "any",
    };
  });
}

interface Result {
  name: string;
  /** Wall-clock bounds, for lining up the RAM and CPU the script samples. */
  from: number;
  to: number;
  fps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  /** Share of frames over 20 ms: the ones that show as stutter. */
  jank: number;
  /** The scene's own work per frame: moving everyone (ms), drawing (ms), and how many frames it drew. */
  tickMs: number;
  renderMs: number;
  drawnPct: number;
}

// Filled in by the scene's frame loop while it exists.
const profile = { tickMs: 0, renderMs: 0, ticks: 0, renders: 0 };
(window as { sceneProfile?: typeof profile }).sceneProfile = profile;

/** In the app, the report is left in its data folder for scripts/bench.mjs to pick up. */
async function save(report: object) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
  await writeTextFile("bench.json", JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
}

// Once per page: StrictMode runs effects twice in dev, and two runs would drive the camera at once.
let started = false;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Times every frame for `ms`, calling `act` each frame with the time elapsed. */
async function sample(name: string, ms: number, act?: (elapsed: number, n: number) => void): Promise<Result> {
  const from = Date.now();
  const start = await frame();
  const gaps: number[] = [];
  let last = start;
  for (let n = 0; ; n++) {
    act?.(last - start, n);
    const t = await frame();
    gaps.push(t - last);
    last = t;
    if (t - start >= ms) break;
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const total = last - start;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    name,
    from,
    to: Date.now(),
    fps: round((gaps.length * 1000) / total),
    meanMs: round(total / gaps.length),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]!),
    maxMs: round(sorted[sorted.length - 1]!),
    jank: round((100 * gaps.filter((g) => g > 20).length) / gaps.length),
    tickMs: round(profile.tickMs / (profile.renders || 1)),
    renderMs: round(profile.renderMs / (profile.renders || 1)),
    drawnPct: Math.round((100 * profile.renders) / (profile.ticks || 1)),
  };
}

export default function Bench() {
  const [blobs] = useState(crowd);
  const layout = useGardenIsland(SIZE);
  const [base, setBase] = useState(params.has("night") ? NIGHT : NOON);
  const [results, setResults] = useState<Result[] | null>(null);
  // The page without the garden first: what the webview costs on its own.
  const [blank, setBlank] = useState(!IDLE);
  const root = useRef<HTMLElement>(null);
  const t0 = useRef(performance.now());
  const clock = () => base + (performance.now() - t0.current) * RATE;

  useEffect(() => {
    if (started || IDLE) return;
    started = true;
    const scene = () => root.current!.firstElementChild as HTMLElement;
    const centre = () => {
      const r = scene().getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const wheel = (deltaY: number) => scene().dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: centre().x, clientY: centre().y, bubbles: true }));
    const pan = async (name: string) => {
      const c = centre();
      scene().dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: c.x, clientY: c.y, bubbles: true }));
      const result = await sample(name, 4000, (e) => {
        // Back and forth, fast: up to 60 px a frame.
        const dx = Math.sin(e / 700) * 60 * 30;
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: c.x + dx, clientY: c.y + dx / 3 }));
      });
      window.dispatchEvent(new PointerEvent("pointerup", {}));
      return result;
    };
    const run = async () => {
      const out: Result[] = [];
      await wait(1000);
      out.push(await sample("blank page", 3000));
      setBlank(false);
      await wait(3000); // Sprites load, the camera settles.
      wheel(4000);
      await wait(1500);
      out.push(await sample("map, idle", 4000));
      wheel(-4000);
      await wait(1500);
      out.push(await sample("close up, idle", 4000));
      out.push(await sample("zoom sweep", 4000, (e) => wheel(e < 2000 ? 25 : -25)));
      let jumped = false;
      out.push(
        await sample("zoom jump", 4000, (e, n) => {
          if (n === 0) wheel(4000);
          else if (e > 2000 && !jumped) {
            jumped = true;
            wheel(-4000);
          }
        }),
      );
      await wait(1000);
      // The blob nearest the middle of the screen.
      const c = centre();
      const distance = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return Math.hypot(r.x - c.x, r.y - c.y);
      };
      const near = [...document.querySelectorAll<HTMLElement>("[data-label]")].sort((a, b) => distance(a) - distance(b))[0];
      out.push(await sample("follow a blob", 4000, (_e, n) => n === 0 && near?.querySelector("p")?.click()));
      out.push(await sample("let go", 3000, (_e, n) => n === 0 && scene().click()));
      out.push(await pan("fast pan"));
      setBase(NIGHT);
      await wait(2000);
      out.push(await sample("night, close up", 4000));
      out.push(await pan("night, fast pan"));
      setResults(out);
      const report = { size: SIZE, blobs: COUNT, userAgent: navigator.userAgent, at: new Date().toISOString(), results: out };
      (window as unknown as { __bench: unknown }).__bench = report;
      console.table(out);
      await save(report);
    };
    // Whatever happens, leave a report: a bench that dies silently looks like one still running.
    run().catch((error: unknown) => save({ error: String(error) }));
  }, []);

  return (
    <main ref={root} className="fixed inset-0">
      {blank || !layout ? null : <Scene key={base} blobs={blobs} reducedMotion={false} layout={layout} blobScale={0.55} startAt="bench-0" clock={clock} />}
      {results ? (
        <table className="absolute top-4 left-4 z-20 rounded-lg bg-background/90 text-xs shadow-lg [&_td]:px-2 [&_th]:px-2">
          <thead>
            <tr>
              <th className="text-left">scenario</th>
              <th>fps</th>
              <th>mean</th>
              <th>p95</th>
              <th>max</th>
              <th>jank %</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.fps}</td>
                <td>{r.meanMs}</td>
                <td>{r.p95Ms}</td>
                <td>{r.maxMs}</td>
                <td>{r.jank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
