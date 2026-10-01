# @blob-land/desktop

## 0.4.0

### Minor Changes

- c32c257: The game can be quit from the main menu and the in-game menu (closing the window still lets your blob live on in the tray). Opening a blob's relations no longer drops it from the camera, and letting go of a blob eases the view back a little instead of snapping to where it was. Clicking a blob from far away now pans to it first, then zooms in smoothly. In the garden, blobs no longer dash across the map or run along walls to reach a far-off spot: they walk round lakes and cliffs at a stroll, and hop or waddle as they should.
- 4a897e1: The garden shows the world's time (UTC, the same for everyone) at the top of the screen, above the island switcher. Joining the garden now takes you straight to it instead of back to the menu or your island.

### Patch Changes

- Updated dependencies [c32c257]
  - @blob-land/sim@0.3.1

## 0.3.0

### Minor Changes

- 33dab08: A new Settings screen, from the main menu or the in-game menu: change who your blob is and who it falls for (shown on your blob as it'll look), your country, whether others can see your blob, and the app's language. Your blob's ID card now only shows who it is. If a change means your blob and its partner are no longer drawn to each other, the settings tell you first: they'll part ways.
  
  Blob Land now speaks French too. It starts in your system's language, and you can switch at any time.
  
  You can also delete your garden account from the settings, with your password. Your own island stays on your device.

### Patch Changes

- Updated dependencies [33dab08]
  - @blob-land/sim@0.3.0

## 0.2.0

### Minor Changes

- 6239fc2: Players can say which country they're from, or not: an optional country (ISO 3166-1 alpha-2) at sign-up (`/auth/register`) or from their blob's ID card (`PATCH /me/country`, null to drop it). `/garden` returns it, and the garden shows its flag next to the blob's name and on its ID card. Local databases need `ALTER TABLE users ADD COLUMN country TEXT`.
- f1b7b73: The app is Blob Land, with its own icon: three blobs stacked on a little floating island, drawn from the game's own sprites. It shows in the Dock and the menu bar under that icon, and keeps a single menu bar icon instead of two.
- ec8a507: A cartoon look that matches the world: a rounded font (Fredoka), bright colours, ink outlines and chunky buttons that press in, on every panel, menu and name tag. The app now opens on a main menu, with clouds drifting over the floating island and three blobs stacked on it, yours on top; naming your blob and joining the garden happen there too, and the in-game menu can take you back to it.
- 6ead444: Family tree panel: parents, current partner, and descendants grouped by the couple they were born to. Click anyone to open their tree, and rename your own children.
- 8dc51b5: The garden plays back on the server's clock, at the rate it reports: a sped-up dev garden walks, meets and turns day to night faster, and is refreshed every 10 seconds.
- 0f9ffc7: Full-screen isometric island: blobs walk, hop and sleep in their nest under a day/night sky, with their current activity shown by their name. Click a blob to follow it. Edit your private island tile by tile (grounds, roads and rivers that join up on their own, hills and ramps, trees, bushes, rocks and cacti) at any size from 2×2 to 16×16. A journal lists what your blob did over the last three days.
- a05f8b7: The private blob lives its random life on the device, catching up on the time the app was closed. Blobs are played back from their stored timelines, couples wander together, children are drawn smaller, and each blob wears a sign of its sex — a bow or a bowler hat, measured onto every silhouette. Sex and attraction are picked when naming the blob and can be changed from its ID card.
- 6f2c81b: Meetings in the garden are animated: once blobs arrive they chat in turns with speech bubbles, argue with a grawlix bubble and a shake, dance to music notes, hug and kiss under hearts, play with a ball, give gifts, make up, sulk under a rain cloud or snub each other. A gathering stands together even when its meeting point lands on a tree or water.
- 7273182: Without a connection, the app says so kindly instead of failing quietly or in server jargon: the garden and joining it wait until the garden can be reached (your own island keeps living), panels that load from the garden show what's wrong with a Try again button, and a change that couldn't be saved says why. Empty panels explain what will show up there and how.
- a7acd37: Blobs hidden behind others are easy to reach: click a name to select its blob, or click again where blobs overlap to go to the next one behind; the selected blob comes to the front. Newborns sparkle for a while, and a blob just out of a couple carries a broken heart (`/garden` flags them as `heartbroken`).
- 70c8a2c: Garden news: `GET /garden/journal` lists the garden's couples, breakups, births and big fights, newest first, and the desktop app shows them in a colourful "Garden news" panel.
- 068af78: The garden is a real island now, generated the same on every client: an ocean ring, beaches, plains and woods, a desert, a snowy mountain with ramps, a river, lakes, and a village in the middle where everyone sleeps. It grows with the garden, from 24×24 to 128×128 tiles, and shows everyone at once (no more pages): only what's on screen is drawn, and zoomed out it's one picture of the island with a dot per blob. Drag to pan, wheel or +/- to zoom; the camera starts on your blob. `legIn` takes a `zoom` so walks keep their pace per tile on big maps.
  
  Blobs sleep in nests scattered over the island, a few to each (couples share one), instead of one pile in the village, and cross the river on footbridges. The island keeps its tile size on screen when it grows a step.
  
  Blobs live in regions, and each region lives whole in its own Durable Object (`Region`, binding `REGION`), in that object's SQLite: its blobs, timelines, relationships, couples and meetings. It lives itself forward on its own alarm every 5 minutes, each step written in one transaction (a step that fails leaves nothing half-written, and the runtime retries it); the cron is now only a watchdog that sets any stopped alarm again. D1 keeps what the whole garden shares: accounts, and a directory of every blob (its region, and its name under one UNIQUE key, so a sign-up and a birth can no longer take the same name). D1's schema is a wrangler migration now (`migrations/`, `pnpm db:apply`), not `schema.sql`. With no production yet, nothing old is carried over: saved islands with pre-pack decor ids and lives without a chronotype are no longer converted on load. `/garden` serves one region (the player's, or `?region=`) with the list of regions and the island's size (`gardenSize`, now in the sim, so every client draws the same island); each region builds its answer once per step and sends the same to all its players, and `?since=<step>` sends only the timeline written since an earlier answer, which the app now asks for. The journal is the player's region's. New accounts join the first region with fewer than `REGION_CAP` (450) blobs, and the next region opens when all are full; at sign-up, a friend's pseudo moves the new blob onto that friend's island instead (up to 50 past the cap). The garden shows the other islands and lets the player go and visit them. Failed requests and steps are logged whole (`[observability]`); `pnpm load` measures the API with 10 000 blobs.
  
  The world is drawn with WebGL (PixiJS) instead of thousands of DOM elements: ground, decor, nests, clouds, map dots and the blobs themselves, each built from its blobatar's shapes and animated exactly as blobatar animates it (breathing, glances, blinks, expression morphs, the hover lift), with the walk cycle and meeting moves on top. Names, meeting effects and the ID card stay in the page, and every blob can still be followed from the keyboard. 60 fps while zooming and panning, day and night, at a fraction of the CPU and about half the memory; the garden island is laid out in a worker.
  
  Zoomed out, blobs stay drawn (without their names past a quarter of the island) until half the island is in view, then the map takes over with a sharper picture, and no white flash either way. Wheel and pinch zoom without scrolling the window, and the garden shows a grab hand. A gathering stands together: its ring is scaled to the island, blobs hurry to it the farther they are (up to five times a stroll), and no one talks till everyone has arrived; the show sits beside the talkers' heads. Pseudos and names are capped at 16 characters (`MAX_NAME_LENGTH`, in the sim).
- 7e1e158: Meetings leave their mark: a blob stays angry for a while after a fight and cools off in its own time, a bad meeting leaves it down, a kiss leaves it dreamy, and a real fight weighs more on its mood. The relations panel can be searched by name, filtered by status (click a summary chip) and sorted (warmest, name, friendship, love, tension, most met), and a blob's ID card has a "See relations" button to open anyone's relations.

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
