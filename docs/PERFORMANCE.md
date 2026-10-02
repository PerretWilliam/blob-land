# Performance

What "fast enough" means for Blob, and where we stand. Every change to how
the garden is drawn or served is measured against this.

## Targets

| | Target |
|---|---|
| Frame rate | 60 fps on a 128×128 island with 450 blobs — zooming, following a blob, panning fast — release build |
| Stutter | under 1 % of frames over 20 ms |
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
of a conversation (the effects over their heads), and by night: close up, the
widest view still drawn blob by blob, panning there, the map, a slow zoom
sweep across the switch to the map, and (by day) a zoom jump, following a
blob, letting go and a fast pan. The page times every frame and the scene's
own work in it (`move ms`, `draw ms`, and how many frames it actually drew),
and says which view each scenario ended in (`near` with names, `far` without,
`map` with dots) and how many names were shown; `scripts/bench.mjs` samples
CPU and RAM of the app and its WebKit processes from outside, split into the
page (JS, DOM, images) and WebKit's GPU process (WebGL, compositing). macOS
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
