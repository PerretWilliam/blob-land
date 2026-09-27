---
"@blob-land/sim": minor
"@blob-land/api": minor
"@blob-land/desktop": minor
---

The garden is a real island now, generated the same on every client: an ocean ring, beaches, plains and woods, a desert, a snowy mountain with ramps, a river, lakes, and a village in the middle where everyone sleeps. It grows with the garden, from 24×24 to 128×128 tiles, and shows everyone at once (no more pages): only what's on screen is drawn, and zoomed out it's one picture of the island with a dot per blob. Drag to pan, wheel or +/- to zoom; the camera starts on your blob. `legIn` takes a `zoom` so walks keep their pace per tile on big maps.

Blobs sleep in nests scattered over the island, a few to each (couples share one), instead of one pile in the village, and cross the river on footbridges. The island keeps its tile size on screen when it grows a step.

Blobs live in regions (`blobs.region`): the world step lives each region on its own, and `/garden` serves one region (the player's, or `?region=`) with the list of regions and the island's size (`gardenSize`, now in the sim, so every client draws the same island). New accounts join the first region with fewer than `REGION_CAP` (450) blobs, and the next region opens when all are full. The garden shows the other islands and lets the player go and visit them. Local databases need `ALTER TABLE blobs ADD COLUMN region INTEGER NOT NULL DEFAULT 0` and `CREATE INDEX blobs_region ON blobs(region)`.
