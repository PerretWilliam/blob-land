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

The bench (`apps/desktop/src/bench`) opens the app on a 128×128 island with
450 blobs and plays the same moves every time: map and close-up at rest, a
zoom sweep, a zoom jump, following a blob and letting go, fast panning, by day
and by night. The page times every frame; `scripts/bench.mjs` samples CPU and
RAM of the app and its WebKit processes from outside. macOS only. In a
browser, open the dev server with `#bench` for the frame timings alone.

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
