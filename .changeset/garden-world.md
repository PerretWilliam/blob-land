---
"@blob-land/sim": minor
"@blob-land/api": minor
"@blob-land/desktop": minor
---

The garden is a real island now, generated the same on every client: an ocean ring, beaches, plains and woods, a desert, a snowy mountain with ramps, a river, lakes, and a village in the middle where everyone sleeps. It grows with the garden, from 24×24 to 128×128 tiles, and shows everyone at once (no more pages): only what's on screen is drawn, and zoomed out it's one picture of the island with a dot per blob. Drag to pan, wheel or +/- to zoom; the camera starts on your blob. `legIn` takes a `zoom` so walks keep their pace per tile on big maps.

Blobs live in regions (`blobs.region`, 0 for everyone for now): the world step lives each region on its own, and `/garden` serves one region (the player's, or `?region=`), so the garden can later split up across writers. Local databases need `ALTER TABLE blobs ADD COLUMN region INTEGER NOT NULL DEFAULT 0` and `CREATE INDEX blobs_region ON blobs(region)`.
