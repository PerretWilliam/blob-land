# @blob-land/api

## 0.4.0

### Minor Changes

- 9b7d9b2: An album of your blob's big moments, in the game menu: its first friend, each best friend, its crushes, couples and children, the friends it made peace with, and its firsts, from a first kiss to a first snowball fight. Each moment is a card with everyone who was there, kept for good.
- 111d03b: Blobs have more character. Three new traits, kindness, loyalty and curiosity, join the five they had: curious blobs wander and find more, kind ones pick fewer fights and make up sooner, and loyal ones take their time falling in love but stay together through more. Personalities now shape who gets on: playful blobs click, two hotheads clash. A blob in a couple flirts less, and if it does, its sweetheart may not like it. And a best friend is special now: one each, two for the most sociable, and a closer friendship can take that place.
- b45ec82: Blobs share new moments. A kind blob cheers up a friend who's feeling low, a blob with a deep crush finally confesses (and it may or may not be mutual), friends tease each other and rivals take jabs, a blob shows off what it just found, and a tired couple or pair of best friends naps side by side. Each has its own little show and journal line. The garden now knows every blob's character, ready for the player to shape their own.
- c325b1e: Shape your blob's character. Settings now has a slider for each of its eight traits (or a "Surprise me" roll), and shows what it reads as, from "Heart of gold & joker" to "Lone wolf & hothead". Every blob's ID card says its character too, and joining the garden brings your blob's character along.
- 1eb13b7: Blobs walk the way their character does: playful ones bounce along, quick-tempered ones stomp, solitary ones take shy little steps, and a few strut proudly. Pick your own blob's walk in Settings, or leave it to its character.
- 6376664: Visits, and a blob in one place at a time. Once your blob lives in the garden, it comes home to your island while you're there, and leaves the garden meanwhile. From the game menu, invite up to five other players' blobs over by their pseudo: each leaves the garden for its stay, a few hours or up to two days for a close friend, and everyone goes back when it's over, when you say goodbye or when you leave your island. What happens there counts everywhere, firsts in the album included. Its player isn't told, and a blob hidden from the garden can't be invited.
- 74e10e0: Seasons and weather. The year has nine seasons, from blossom time and firefly nights to shooting stars, falling leaves and misty days, and the sky changes every few hours: sunshine, clouds, rain, storms, snow and fog, the same for everyone on an island. Blobs feel it: they keep in when it rains, head out in the snow, and doze through a summer afternoon's heat. The season and the sky show at the top of the screen.

### Patch Changes

- Updated dependencies [9b7d9b2]
- Updated dependencies [111d03b]
- Updated dependencies [b45ec82]
- Updated dependencies [1eb13b7]
- Updated dependencies [d3828dc]
- Updated dependencies [3cca5c7]
- Updated dependencies [6376664]
- Updated dependencies [81b36ba]
- Updated dependencies [74e10e0]
  - @blob-land/sim@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [c32c257]
  - @blob-land/sim@0.3.1

## 0.3.0

### Minor Changes

- 8601ce1: The garden's server can now be hosted by anyone: it runs as a Docker container on Postgres (`docker compose up` in `apps/api`), and as many copies as needed can share one garden. Answers are gzipped and the garden loads faster under many players at once.
  
  When a pseudo is taken, the names suggested instead now always fit the 16 characters a pseudo may have.
- 8601ce1: A player hidden from the garden is now hidden everywhere: not shown as anyone's partner, at anyone's meeting, in the news, in family trees or in relationships. A player can delete their account (with their password), and its pseudo is free to take again; children born in the garden stay, with their other parent. A blob whose new identity means it and its partner are no longer drawn to each other breaks up with them.

### Patch Changes

- Updated dependencies [33dab08]
  - @blob-land/sim@0.3.0

## 0.2.0

### Minor Changes

- 6e7ee0a: Children get a generated name at birth that their parents can change (`PATCH /blobs/:seed/name`). Names and account pseudos share one namespace, so no two blobs ever answer to the same name. `/tree/:seed` now returns the blob's name, its current partner, and the couple each descendant was born to; `/garden` shows children by name.
- 2b64b7a: A cron trigger now runs the world step every 5 minutes, the only writer of what blobs do, living everyone 30 minutes ahead. New schema (reset): every blob has a row, unions are between blob seeds, and segments, relationships and interactions are stored. `/garden` returns each blob's timeline, identity and partner; `/auth/register` takes an optional sex and attraction, and `PATCH /me/identity` changes them.
- 8dc51b5: A local dev garden can run faster than real time: set `TIME_SCALE` in `.dev.vars`. `/garden` now returns the clock's `rate` next to `now`, and every garden time (timelines, births, relationships, family trees, the world step) follows that clock.
- 6239fc2: Players can say which country they're from, or not: an optional country (ISO 3166-1 alpha-2) at sign-up (`/auth/register`) or from their blob's ID card (`PATCH /me/country`, null to drop it). `/garden` returns it, and the garden shows its flag next to the blob's name and on its ID card. Local databases need `ALTER TABLE users ADD COLUMN country TEXT`.
- a7acd37: Blobs hidden behind others are easy to reach: click a name to select its blob, or click again where blobs overlap to go to the next one behind; the selected blob comes to the front. Newborns sparkle for a while, and a blob just out of a couple carries a broken heart (`/garden` flags them as `heartbroken`).
- 70c8a2c: Garden news: `GET /garden/journal` lists the garden's couples, breakups, births and big fights, newest first, and the desktop app shows them in a colourful "Garden news" panel.
- 068af78: The garden is a real island now, generated the same on every client: an ocean ring, beaches, plains and woods, a desert, a snowy mountain with ramps, a river, lakes, and a village in the middle where everyone sleeps. It grows with the garden, from 24×24 to 128×128 tiles, and shows everyone at once (no more pages): only what's on screen is drawn, and zoomed out it's one picture of the island with a dot per blob. Drag to pan, wheel or +/- to zoom; the camera starts on your blob. `legIn` takes a `zoom` so walks keep their pace per tile on big maps.
  
  Blobs sleep in nests scattered over the island, a few to each (couples share one), instead of one pile in the village, and cross the river on footbridges. The island keeps its tile size on screen when it grows a step.
  
  Blobs live in regions, and each region lives whole in its own Durable Object (`Region`, binding `REGION`), in that object's SQLite: its blobs, timelines, relationships, couples and meetings. It lives itself forward on its own alarm every 5 minutes, each step written in one transaction (a step that fails leaves nothing half-written, and the runtime retries it); the cron is now only a watchdog that sets any stopped alarm again. D1 keeps what the whole garden shares: accounts, and a directory of every blob (its region, and its name under one UNIQUE key, so a sign-up and a birth can no longer take the same name). D1's schema is a wrangler migration now (`migrations/`, `pnpm db:apply`), not `schema.sql`. With no production yet, nothing old is carried over: saved islands with pre-pack decor ids and lives without a chronotype are no longer converted on load. `/garden` serves one region (the player's, or `?region=`) with the list of regions and the island's size (`gardenSize`, now in the sim, so every client draws the same island); each region builds its answer once per step and sends the same to all its players, and `?since=<step>` sends only the timeline written since an earlier answer, which the app now asks for. The journal is the player's region's. New accounts join the first region with fewer than `REGION_CAP` (450) blobs, and the next region opens when all are full; at sign-up, a friend's pseudo moves the new blob onto that friend's island instead (up to 50 past the cap). The garden shows the other islands and lets the player go and visit them. Failed requests and steps are logged whole (`[observability]`); `pnpm load` measures the API with 10 000 blobs.
  
  The world is drawn with WebGL (PixiJS) instead of thousands of DOM elements: ground, decor, nests, clouds, map dots and the blobs themselves, each built from its blobatar's shapes and animated exactly as blobatar animates it (breathing, glances, blinks, expression morphs, the hover lift), with the walk cycle and meeting moves on top. Names, meeting effects and the ID card stay in the page, and every blob can still be followed from the keyboard. 60 fps while zooming and panning, day and night, at a fraction of the CPU and about half the memory; the garden island is laid out in a worker.
  
  Zoomed out, blobs stay drawn (without their names past a quarter of the island) until half the island is in view, then the map takes over with a sharper picture, and no white flash either way. Wheel and pinch zoom without scrolling the window, and the garden shows a grab hand. A gathering stands together: its ring is scaled to the island, blobs hurry to it the farther they are (up to five times a stroll), and no one talks till everyone has arrived; the show sits beside the talkers' heads. Pseudos and names are capped at 16 characters (`MAX_NAME_LENGTH`, in the sim).

### Patch Changes

- 9c052ee: Early birds and night owls: every blob has a chronotype that moves its night by up to 4 hours either way, and it sleeps until its own morning, so the garden is rarely all asleep (in a 20-blob garden, 8 to 11 are still up at 21:00 UTC and a few past 23:00, where none were before). Blobs from before get a chronotype rolled once and stored on the next world step (or next launch, for the private blob).
- Updated dependencies [6239fc2]
- Updated dependencies [068af78]
- Updated dependencies [7e1e158]
- Updated dependencies [9df585b]
- Updated dependencies [9c052ee]
- Updated dependencies [4ae995c]
- Updated dependencies [3be0ba8]
- Updated dependencies [b83ff26]
- Updated dependencies [941d293]
  - @blob-land/sim@0.2.0
