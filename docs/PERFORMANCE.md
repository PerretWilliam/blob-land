# Performance

What "fast enough" means for Blob, and where we stand. Every change to how
the garden is drawn or served is measured against this.

## Targets

| | Target |
|---|---|
| Frame rate | the screen's own rate up to ~120 fps (120 on a ProMotion Mac; a 240 Hz screen gets every other frame), on a 128×128 island with 450 blobs — zooming, following a blob, panning fast — release build |
| Stutter | under 1 % of frames over 12 ms (a frame missed at 120 Hz) |
| CPU while nothing is asked of it (map view, window in the background) | under 5 % |
| RAM (app + its WebKit processes) | under 300 MB |
| API | 10 000 blobs without slowing down, `/garden` under 50 ms, no lost data when a step fails |

## Measuring the app

```bash
pnpm --filter @blob-land/desktop bench              # release build with the bench, then run it
pnpm --filter @blob-land/desktop bench --skip-build # run the last bench build again
```

The bench (`apps/desktop/src/bench`) opens the app on a blank page first
(what the webview costs on its own), then on the fullest island there is: 450
blobs on 128×128, with players' kinds of pseudos. It starts on the small
island the app shows before the server says the garden's size, and grows it.
Then the same round three times, with everyone walking, everyone in the middle
of a conversation (the effects over their heads), and by night in a storm (the
sky's busiest: 200 raindrops, lightning, the grey gloom's filter): close up, the
widest view still drawn blob by blob, panning there, the map, a slow zoom
sweep across the switch to the map, and (by day) a zoom jump, following a
blob, letting go and a fast pan. The page times every frame and the scene's
own work in it (`move ms`, `draw ms`, and how many frames it actually drew;
`jank %` is the share of frames over 12 ms, a frame missed at 120 Hz),
and says which view each scenario ended in (`near` with names, `far` without,
`map` with dots) and how many names were shown; `scripts/bench.mjs` samples
CPU and RAM of the app and its WebKit processes from outside, split into the
page (JS, DOM, images) and WebKit's GPU process (WebGL, compositing), for
RAM and CPU alike (100 % CPU is one core busy). macOS
only; keep its window in front while it runs, as a hidden webview slows its
frames down. `VITE_BENCH_SIZE` and `VITE_BENCH_N` change the island and the crowd.

In a browser, open the dev server with `#bench` for the frame timings alone;
`?idle#bench` shows the same island without playing the moves, to look around
by hand, `?talk` with everyone talking, `?night` by night, `?rate=20` with
garden time 20 times faster, `?size=` and `?n=` another island and crowd.

## Baseline — 2026-09-27, before the WebGL renderer

DOM renderer (one element per tile, decor and blob), after the first round of
fixes (per-sprite filters, forced style recalcs, memoised blobs). Apple M4 Pro,
24 GB, release build.

| Scenario | fps | p95 ms | max ms | jank % | CPU % | RAM MB |
|---|---|---|---|---|---|---|
| map, idle | 55.4 | 28 | 56 | 9.5 | 164 | 1346 |
| close up, idle | 60 | 18 | 24 | 0.4 | 37 | 1373 |
| zoom sweep | 53.5 | 32 | 156 | 14.4 | 119 | 1413 |
| zoom jump | 53.5 | 32 | 61 | 17.3 | 108 | 1368 |
| follow a blob | 60 | 18 | 27 | 0.4 | 41 | 1371 |
| let go | 60 | 18 | 33 | 0.6 | 38 | 1371 |
| fast pan | 60 | 18 | 18 | 0 | 41 | 1293 |
| night, close up | 60 | 18 | 25 | 0.4 | 48 | 1240 |
| night, fast pan | 40.8 | 91 | 190 | 19.6 | 95 | 1295 |

Peak RAM 1413 MB. Far off on RAM (×4.7) and CPU (up to 164 % at rest on the
map), stutter while zooming and panning at night.

## After phase 1 — 2026-09-27, the WebGL renderer

The world drawn with PixiJS (`components/world.ts`): ground and decor as
sprites of the chunks in view, blobs as their blobatar's own shapes, moved
exactly as blobatar's stylesheet moves them (`lib/blob-motion.ts`, checked
against blobatar's own transforms), names and meeting effects left in the DOM
over the canvas. Same machine, same build settings.

| Scenario | fps | p95 ms | max ms | jank % | CPU % | RAM MB | page MB | GPU MB |
|---|---|---|---|---|---|---|---|---|
| blank page | 60.2 | 18 | 18 | 0 | 6–26 | 305–511 | 155–221 | 25–151 |
| map, idle | 60 | 18 | 19 | 0 | 28–30 | 614–630 | 295–307 | 178–183 |
| close up, idle | 60 | 18 | 20 | 0 | 27–32 | 648–684 | 313–351 | 193–196 |
| zoom sweep | 60 | 18 | 21 | 0.4 | 52–54 | 716–735 | 371–392 | 203–205 |
| zoom jump | 60 | 18 | 20 | 0 | 44–46 | 730–745 | 382–398 | 204–208 |
| follow a blob | 60 | 18 | 19 | 0 | 31 | 733–750 | 384–402 | 207–209 |
| let go | 60 | 18 | 18 | 0 | 30–31 | 734–752 | 385–404 | 207–208 |
| fast pan | 60 | 18 | 18 | 0 | 36–38 | 755–775 | 400–421 | 212–215 |
| night, close up | 60 | 18 | 19 | 0 | 35–36 | 747–767 | 398–419 | 207–209 |
| night, fast pan | 60 | 18 | 23 | 1.7 | 49–50 | 752–771 | 399–420 | 209–212 |

Ranges over the last runs: the blank page varies with whether the island is
still being laid out in its worker when it's sampled.

- **Frames**: 60 fps everywhere, stutter gone (was 10–20 % while zooming and
  panning at night). The scene's own work is about 1 ms a frame.
- **CPU**: 28–50 %, from 95–164 %. What's left is mostly WebKit presenting
  the canvas 60 times a second close up (blobs breathe, so every frame is a
  new one); the map at rest draws a quarter of its frames. The bench's own
  sampling loop costs ~6 % on a blank page, so "under 5 %" can't be read here.
- **RAM**: ~750 MB peak, from ~1.4 GB. Of that, ~125 MB is the app process and
  ~210 MB the GPU process (the canvas and its sprites); a blank page with a
  small island already costs ~215 MB in all. Laying out a big island used to
  leave ~300 MB behind in the page (WebKit's engine keeps the memory a burst
  of allocations took): it now runs in a worker, whose memory goes with it,
  and the island code and path search allocate nothing in their hot loops.

Still over target on RAM (×2.5) and CPU at rest. Two levers, measured
(same bench, 2026-09-27) and left out:

- **Canvas at 1× instead of the screen's 2×**: CPU and RAM within noise of 2×
  (close up 26 % CPU, 669 MB; GPU process −10 MB). Pixels aren't the cost.
- **Idle animation at 30 fps close up**: 24 % CPU instead of 26 %, and blobs
  visibly less smooth. Not worth it.

The floor explains why: the bench's *blank page* — no world at all, just the
app, WebKit and the bench's own frame counter — already costs 17–20 % CPU and
~515 MB (app ~140, page ~220, GPU ~155). The world adds ~10 points of CPU and
~250 MB on top. So the 5 % and 300 MB targets are below what an empty Tauri
window costs here, and need re-setting against that floor; what's left to win
is in the world's share (texture atlases for the GPU process, fewer live
sprites far from the camera), to be measured after the API work.

## The API — 2026-09-30, Node and Postgres in Docker

`pnpm --filter @blob-land/api load 10000 20 600` against the API's Docker
image and `postgres:17-alpine` (`docker compose`, Podman on an M-series Mac,
one API container, pool of 10), 10 000 blobs in 24 regions of 450:

| | Result |
|---|---|
| Filling 10 000 blobs, each region then lived once | 4.2 s |
| One step of every region (5 min more, 24 regions at once) | 0.4 s in all |
| `/garden` whole, one client | 183 answers/s, p50 5 ms, p95 9 ms, 281 KB (69 KB gzipped) |
| `/garden` whole, 20 clients at once | 867 answers/s, p50 22 ms, p95 30 ms, p99 41 ms |
| `/garden?since=` after one step, 20 clients | 1 157 answers/s, p50 14 ms, p95 38 ms, 105 KB |
| Memory, after the run | API 239 MB, Postgres 106 MB |

- 3.5× the answers of the Worker version under 20 clients (246/s), at a
  quarter of its median. A region's answer is still built once per change
  and sent to every player of it; the only query most requests make is the
  region's version, to know the view is still good.
- Every answer is gzipped now (Cloudflare used to do it): 281 KB of timeline
  goes out as 69 KB, and the compressing is part of the numbers above.
- More API containers on the same database add answers per second and share
  the steps; Postgres is then what to watch (the `segments` table is the
  big one, ~3 days of timeline per region).

## The API — 2026-09-27, regions in their own objects (replaced)

`pnpm --filter @blob-land/api load 10000 20 500` against `wrangler dev`
(local workerd, `TIME_SCALE=1`), 10 000 blobs in 24 regions of 450:

| | Result |
|---|---|
| One step of every region (450 blobs each, 30 min lived) | 0.8 s in all, ~35 ms a region |
| `/garden` whole, one client | p50 5 ms, p95 8 ms, 288 KB |
| `/garden` whole, 20 clients at once | 246 answers/s, p50 81 ms (queued: local workerd runs one request at a time) |
| `/garden?since=` after one step, 20 clients | 561 answers/s, p50 33 ms, 111 KB |

- Under the 50 ms target by a wide margin for one request; the 20-client
  numbers are one local process doing everything in turn, ~4 ms of work an
  answer. On Cloudflare each region is its own object and requests spread
  over Worker instances.
- A region builds its answer once per step and sends the same string to all
  its players; `since` answers for the last steps are kept too.
- A step is one SQLite transaction in its region's object: a failed step keeps
  nothing, is retried by the runtime, and the cron sets a lost alarm again.
- The local runtime (wrangler 3, workerd 2025-07) keeps memory from every
  request it serves, even a bare "hello" Worker (~10 KB each), and dies near
  1.5 GB: the load test sends a fixed number of requests, not a duration.
  Numbers from Cloudflare's network need a deployed API (not yet: no D1 id).

## Zooming out on a full island — 2026-09-27

The map (dots on one baked picture of the island) used to take over past
2 000 cells in view, about an eighth of a full island: too soon, and its
picture (4 096 px across) was blown up 2.3× on a Retina screen there. Every
size change also left the frame loop with the first island's size, so a
garden that opened on the small placeholder island never switched to the map
at all, and drew all 450 blobs with their names when zoomed out.

Now, on a full island with everyone talking (release build, M-series Mac):

| Threshold | Widest view before the map | CPU there | Jank |
|---|---|---|---|
| Map past 2 000 cells | ~40 blobs, named | 42 % | 0 |
| Map past 8 000 cells, names everywhere | ~190 blobs, named | 191 % | 17 % |
| Map past 8 000, names within 2 500 | ~190 blobs, 0 names | 54 % | 0 |

Names and meeting effects are HTML: a few hundred of them are what costs, not
the blobs (under 3 ms a frame to move and draw at the widest). So from
2 500 cells on, blobs go on without them, and the map comes at 8 000 cells,
half the island, with a 6 144 px picture that's about 1:1 there. Every
scenario holds 60 fps, jank ≤ 3 %, CPU ≤ 61 %, RAM steady at ~800 MB.

## Gaits — 2026-10-02

Five walk cycles instead of one (`GAITS` in `scene.tsx`), each blob's picked
from its character or by its player; the bench now gives its crowd all five
in turn, so a fifth of it hops on every step. The cycle is the same handful of
sines per blob in view, only with per-gait numbers, so nothing measurable
moved. Release build, M4 Pro, against `main` the same evening:

| Scenario | fps (main → gaits) | jank % | CPU % | RAM MB |
|---|---|---|---|---|
| walking: close up | 60 → 60 | 0.4 → 0.4 | 32 → 30 | 962 → 991 |
| walking: widest, pan | 57 → 57 | 2.2 → 2.2 | 57 → 57 | 1008 → 1031 |
| talking: widest before map | 60 → 60 | 0 → 0 | 66 → 68 | 1160 → 1177 |
| night: widest, pan | 59.7 → 60 | 2.1 → 2.1 | 61 → 64 | 1300 → 1342 |

Every scenario holds 60 fps (57 on the fast pan at the widest, as before), jank
≤ 2.2 %. Three earlier runs of the same code timed out with no report, the
bench window half hidden behind others in use: keep it in front while it runs.

## Weather — 2026-10-03

Seasons and weather drawn over the world (`sky.ts`): up to 200 raindrops (a
storm), or a few dozen petals, leaves, fluff or fireflies, placed each frame
by a formula of the time, plus fog and lightning as two full-screen sprites; a
grey sky also dims the world through the night filter, so a cloudy day costs
that pass too. The bench's night round is now a storm, the worst of it. Release
build, M4 Pro, against the gaits run (main, clear night):

| Scenario | fps (gaits → weather) | jank % | CPU % | RAM MB |
|---|---|---|---|---|
| walking: close up | 60 → 60 | 0.4 → 0 | 30 → 28 | 991 → 1041 |
| walking: widest, pan | 57 → 57.8 | 2.2 → 3.5 | 57 → 57 | 1031 → 1175 |
| talking: widest before map | 60 → 60 | 0 → 0 | 68 → 72 | 1177 → 1302 |
| night (storm): widest, pan | 60 → 60 | 2.1 → 1.7 | 64 → 58 | 1342 → 1509 |

60 fps throughout (57.8 on the fast pan at the widest, as before). RAM is up
on every row, the walking ones included, which draw no weather (a January noon,
clear): the run-to-run spread, mostly, and the leak the performance phase is
for. Two runs timed out first, with the Browser pane open over the bench
window; closing it, the third finished.

## 120 fps — 2026-10-04

WebKit drew at 60 fps at most, even on a 120 Hz screen: its "prefer page
rendering updates near 60 fps" feature is now turned off at start (see
DECISIONS.md). At 120 fps a frame has 8.3 ms, so the work per frame was cut
down, profiled scenario by scenario:

- A blob's walk is worked out once per leg (routes, snapped stops, meeting
  places) and only played along after: `targets` went from 1.9–3.9 ms to
  0.2–0.4 ms a frame for 450 blobs.
- Walking blobs changed the depth order every frame, which makes Pixi rebuild
  and repack everything it draws: their depths now apply 20 times a second.
- The nests were shapes, 785 000 triangle corners kept in memory and repacked
  with every new order: now one picture, drawn once.
- Pixi ran a frame loop of its own for its upkeep: now once a second, from the scene's.
- A blob's nested transforms are multiplied out (3 per blob instead of 7),
  its pose is kept once a change of expression has played, and its shapes,
  poses and sign are worked out ahead, a few blobs at a time.
- Measuring where a sign sits went through the DOM (`getPointAtLength`), up to
  ~7 ms a blob the first time it came into view, 770 ms for a crowd: now
  sampled in JS, 0.05 ms, the same anchors within a hundredth of a blob.
- Chunks are dropped in one go, labels re-render only when what they show
  changes and between frames, and the timelines map stays the same while the
  timelines do.
- One renderer for the app's life; a sprite's pixels on the GPU only; the
  map's picture made on demand, a slice a frame, and let go of after half a
  minute close up.

Release build, M4 Pro, ProMotion screen. Before: the weather run (2026-10-03,
capped at 60), then the same code with the cap lifted; after: this branch.

| Scenario | fps 60 cap → lifted → after | jank % (>12 ms) after | CPU % 60 cap → lifted → after | RAM MB 60 cap → lifted → after |
|---|---|---|---|---|
| walking: close up | 60 → 120 → 120 | 0 | 28 → 41 → 32 | 1041 → 1001 → 721 |
| walking: widest before map | – → 120 → 120 | 0 | – → 88 → 64 | – → 1006 → 726 |
| walking: widest, pan | 57.8 → 111 → 118 | 1.1 | 57 → 81 → 67 | 1175 → 1068 → 804 |
| walking: map | – → 120 → 120 | 0 | – → 35 → 29 | – → 1067 → 825 |
| walking: follow a blob | – → 120 → 120 | 0 | – → 38 → 27 | – → 1125 → 865 |
| talking: widest before map | 60 → 99 → 120 | 0 | 72 → 114 → 76 | 1302 → 1202 → 886 |
| talking: widest, pan | – → 114.5 → 117.8 | 1.3 | – → 88 → 73 | – → 1254 → 890 |
| night (storm): widest, pan | 60 → 113.3 → 117.8 | 1.7 | 58 → 89 → 75 | 1509 → 1303 → 893 |
| peak RAM | 1509 → 1368 → 896 | | | |

- **Frames**: 120 fps everywhere but the fast pans at the widest zoom, 118
  with 1–2 % of frames late (the longest ~30 ms, as new ground and blobs come
  into view); the worst hitch went from 233 ms to ~30 ms. The scene's own work
  is 0.1–2.5 ms a frame (from 1–7 ms).
- **CPU**: twice the frames for about the CPU 60 fps took. What's left is
  mostly WebKit's: of 64–76 % at the widest, ~40–48 points are the page
  process (our JS is ~24 of them) and ~20–28 the GPU process; close up,
  ~17 + 10.
- **RAM**: 896 MB at peak, from 1.37 GB with the cap lifted (1.51 GB before):
  the GPU process went from ~360–470 MB to ~245–270 MB, the page from
  ~500–770 MB to ~330–510 MB. The page still grows over a run (JS engine
  memory kept after bursts of allocations), and a bare window costs ~230 MB.

## Garden relief — 2026-10-04

The garden's islands now have relief (a mountain of up to 7 blocks, hills and
mesas everywhere, see DECISIONS.md), which stacks more blocks per cell. A
block under another, with blocks in front of both its sides, is never seen,
so it is no longer drawn: under a hill, only the top and the cliffs are. On
the 128×128 island that leaves ~16 500 ground sprites, about what the old
island drew with its one mountain (~20 400 before the same culling). Laying
an island out takes ~130 ms in the worker (from ~40 ms): its rivers and roads
are searched for, not drawn straight.

Release build, M4 Pro, ProMotion screen; before: the 120 fps run above.

| Scenario | fps before → after | CPU % before → after | RAM MB before → after | GPU MB before → after |
|---|---|---|---|---|
| walking: close up | 120 → 120 | 32 → 40 | 721 → 739 | 244 → 234 |
| walking: widest before map | 120 → 120 | 64 → 64 | 726 → 753 | 244 → 237 |
| walking: widest, pan | 118 → 118.3 | 67 → 66 | 804 → 798 | 251 → 244 |
| talking: widest before map | 121.8 → 120.2 | 76 → 82 | 886 → 767 | 266 → 137 |
| night (storm): widest, pan | 117.8 → 117 | 75 → 75 | 893 → 838 | 250 → 180 |
| peak RAM | 896 → 897 | | | |

Frames are unchanged: 120 fps everywhere but the fast pans at the widest zoom
(117–118, 1–2 % late). Walks route round more cliffs and water, so moving
everyone costs a little more on the map (0.9 → 1.6 ms a frame), still well
inside the frame. CPU and RAM are within a run's spread.
