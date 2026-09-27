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
(what the webview costs on its own), then on a 128×128 island with 450 blobs,
and plays the same moves every time: map and close-up at rest, a zoom sweep,
a zoom jump, following a blob and letting go, fast panning, by day and by
night. The page times every frame and the scene's own work in it (`move ms`,
`draw ms`, and how many frames it actually drew); `scripts/bench.mjs` samples
CPU and RAM of the app and its WebKit processes from outside, split into the
page (JS, DOM, images) and WebKit's GPU process (WebGL, compositing). macOS
only. `VITE_BENCH_SIZE` and `VITE_BENCH_N` change the island and the crowd.

In a browser, open the dev server with `#bench` for the frame timings alone;
`?idle#bench` shows the same island without playing the moves, to look around
by hand, `?night` by night, `?size=` and `?n=` another island and crowd.

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

Still over target on RAM (×2.5) and CPU at rest. Next levers, measured before
taken: drawing close-ups at a lower resolution than the screen's, textures
packed into atlases, and a lighter frame loop when nothing on screen changes.
