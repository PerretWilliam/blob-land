/*
 * The performance bench: the fullest island there is (REGION_CAP blobs on
 * MAX_GARDEN tiles), put through the same scripted moves every run while
 * every frame is timed. Twice over: everyone out walking, then everyone in
 * the middle of a conversation (their effects over their heads); and by
 * night. Each zoom that costs something is covered: close up, the widest
 * view still drawn blob by blob, the map, and sweeps across the switch
 * between the two. It also starts on a small island that grows, as the app
 * does before the server says how big the garden is.
 *
 * Opened with `#bench` on the dev server, or built into the app with
 * VITE_BENCH=1 (see scripts/bench.mjs, which also reads RAM and CPU).
 * `?size=` and `?n=` change the island and the crowd; `?idle` shows it
 * without playing the moves, to look around by hand (`?talk` with everyone
 * talking, `?night` by night, `?rate=20` with garden time 20 times faster).
 */
import { GAITS, INTERACTIONS, MAX_GARDEN, playerPseudo, REGION_CAP, seededRng, type Segment } from "@blob-land/sim";
import { BaseDirectory, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useRef, useState } from "react";
import { expressionNamed, Scene, type SceneBlob } from "@/components/scene";
import { useGardenIsland } from "@/lib/use-garden-island";

const params = new URLSearchParams(location.search);
// Also settable when building the bench app (VITE_BENCH_SIZE, VITE_BENCH_N), which has no URL to pass them in.
const SIZE = Number(params.get("size") ?? import.meta.env.VITE_BENCH_SIZE ?? MAX_GARDEN);
const COUNT = Number(params.get("n") ?? import.meta.env.VITE_BENCH_N ?? REGION_CAP);
const IDLE = params.has("idle");
// Garden time's pace, like the API's TIME_SCALE in dev.
const RATE = Number(params.get("rate") ?? 1);
// The island the app shows before the server says the garden's size.
const FIRST_SIZE = 24;

const HOUR = 60 * 60 * 1000;
const SLOT = 10 * 60 * 1000;
// Garden times the bench plays at (UTC, like daylight()): everyone walking at
// noon, everyone talking the next noon, and deep in the night.
const WALK = Date.UTC(2026, 0, 1, 12);
const TALK = Date.UTC(2026, 0, 2, 12);
const NIGHT = Date.UTC(2026, 0, 3, 1);
const EXPRESSIONS = ["idle", "happy", "sleepy", "love", "thinking", "wink"];
const OUTCOMES = ["good", "good", "meh", "bad"];

/** The crowd, the same every run: wandering around WALK and NIGHT, in groups of two to four around TALK. */
function crowd(): SceneBlob[] {
  const rng = seededRng(7);
  const segments: Segment[][] = Array.from({ length: COUNT }, () => []);
  const around = (base: number) => ({ from: base - HOUR, to: base + 2 * HOUR });
  const expression = () => EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)]!;
  for (const base of [WALK, NIGHT]) {
    const { from, to } = around(base);
    for (const list of segments) {
      for (let t = from; t < to; t += SLOT) {
        list.push({ start: t, end: t + SLOT, activity: rng() < 0.8 ? "explore" : "rest", expression: expression(), x: rng(), y: rng(), rng: Math.floor(rng() * 2 ** 31), with: null, detail: null });
      }
    }
  }
  // Everyone at a meeting, the whole time: groups meet somewhere, then somewhere else.
  const { from, to } = around(TALK);
  for (let i = 0; i < COUNT; ) {
    const group = Array.from({ length: Math.min(COUNT - i, 2 + Math.floor(rng() * 3)) }, (_, k) => i + k);
    i += group.length;
    for (let t = from; t < to; t += SLOT) {
      const [x, y] = [0.05 + rng() * 0.9, 0.05 + rng() * 0.9];
      const detail = `${INTERACTIONS[Math.floor(rng() * INTERACTIONS.length)]!}:${OUTCOMES[Math.floor(rng() * OUTCOMES.length)]!}`;
      group.forEach((b, k) => {
        const angle = (2 * Math.PI * k) / group.length;
        segments[b]!.push({
          start: t,
          end: t + SLOT,
          activity: "meet",
          expression: expression(),
          x: x + Math.cos(angle) * 0.01,
          y: y + Math.sin(angle) * 0.01,
          rng: Math.floor(rng() * 2 ** 31),
          with: group.filter((o) => o !== b).map((o) => `bench-${o}`),
          detail,
        });
      });
    }
  }
  return segments.map((list, i) => {
    list.sort((a, b) => a.start - b.start);
    return {
      seed: `bench-${i}`,
      label: playerPseudo(rng),
      segments: list,
      expression: expressionNamed(list[0]!.expression),
      activity: "explore",
      sex: (["female", "male", "none"] as const)[i % 3]!,
      gait: GAITS[i % GAITS.length]!,
      attraction: "any",
      country: rng() < 0.4 ? (["FR", "JP", "BR", "US", "DE", "IN", "NG", "KR"] as const)[Math.floor(rng() * 8)]! : undefined,
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
  /** Names shown at the end: all the blobs in view close up, a handful otherwise. */
  shown: number;
  /** The view it ended in: near, far or map. */
  view: string;
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
const shown = () => document.querySelectorAll("[data-label]").length;
/** "near" (names and all), "far" (blobs without names) or "map" (dots): see the scene. */
const view = () => document.querySelector<HTMLElement>("[data-view]")?.dataset.view ?? "";

/** Times every frame for `ms`, calling `act` each frame with the time elapsed. */
async function sample(name: string, ms: number, act?: (elapsed: number, n: number) => void): Promise<Result> {
  Object.assign(profile, { tickMs: 0, renderMs: 0, ticks: 0, renders: 0 });
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
    shown: shown(),
    view: view(),
  };
}

export default function Bench() {
  const [blobs] = useState(crowd);
  const [size, setSize] = useState(IDLE ? SIZE : FIRST_SIZE);
  const layout = useGardenIsland(size);
  const [base, setBase] = useState(params.has("night") ? NIGHT : params.has("talk") ? TALK : WALK);
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
    const wheel = (deltaY: number) => scene().dispatchEvent(new WheelEvent("wheel", { deltaY, clientX: centre().x, clientY: centre().y, bubbles: true, cancelable: true }));
    const mapOut = () => wheel(20_000);
    const closeUp = () => wheel(-20_000);
    /** From the map, zooms in a notch at a time until blobs are drawn again: the widest view that isn't the map. */
    const widest = async () => {
      mapOut();
      await wait(1500);
      for (let i = 0; i < 200 && view() === "map"; i++) {
        wheel(-15);
        await wait(40);
      }
      await wait(1500);
    };
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
    /** The same round at whatever time it is: still at every zoom, then moving. */
    const round = async (label: string, out: Result[], extra: boolean) => {
      closeUp();
      await wait(1500);
      out.push(await sample(`${label}: close up`, 4000));
      await widest();
      out.push(await sample(`${label}: widest before map`, 4000));
      out.push(await pan(`${label}: widest, pan`));
      mapOut();
      await wait(1500);
      out.push(await sample(`${label}: map`, 4000));
      // Close up to the map and back, slowly: across the switch both ways.
      out.push(await sample(`${label}: zoom sweep`, 6000, (e) => wheel(e < 3000 ? -12 : 12)));
      if (!extra) return;
      out.push(
        await sample(`${label}: zoom jump`, 4000, (e, n) => {
          if (n === 0) closeUp();
          else if (e > 2000 && e < 2100) mapOut();
        }),
      );
      closeUp();
      await wait(1500);
      // The blob nearest the middle of the screen.
      const c = centre();
      const distance = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return Math.hypot(r.x - c.x, r.y - c.y);
      };
      const near = [...document.querySelectorAll<HTMLElement>("[data-label]")].sort((a, b) => distance(a) - distance(b))[0];
      out.push(await sample(`${label}: follow a blob`, 4000, (_e, n) => n === 0 && near?.querySelector("p")?.click()));
      out.push(await sample(`${label}: let go`, 3000, (_e, n) => n === 0 && scene().click()));
      out.push(await pan(`${label}: close up, pan`));
    };
    const at = async (time: number) => {
      setBase(time);
      await wait(2500); // The scene comes back for the new time: sprites, camera.
    };
    const run = async () => {
      const out: Result[] = [];
      await wait(1000);
      out.push(await sample("blank page", 3000));
      setBlank(false);
      await wait(2000);
      // The small island first, then the full size, as when the app opens.
      setSize(SIZE);
      await wait(3000);
      mapOut();
      await wait(1500);
      out.push(await sample("grown island: map", 3000));
      await round("walking", out, true);
      await at(TALK);
      await round("talking", out, true);
      await at(NIGHT);
      await round("night", out, false);
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
              <th>view</th>
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
                <td>{r.view}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
