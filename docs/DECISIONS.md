# Decisions

Lightweight log of decisions already made, one paragraph each. This is a flat list, not a changelog.

## Local-first before account

The app is usable with zero network calls and no account: on first launch, picking a pseudo creates a local blob (seed, simulated state, journal) entirely offline. "Join the garden" is a separate, explicit action, not a gate the user has to pass before seeing their blob.

## Children are first-class blobs, not sub-records of their parents

A child born from a union gets its own row in the `blobs` table, addressable and displayable independently of the union or its parents. There's no ownership relationship — a child isn't "attached" to an account.

## Random, stored, played back — not deterministic

Blobs used to be a formula of (seed, time): the same inputs always gave the same day, which made them predictable. Now every choice — when to sleep, where to walk, who to meet, how it goes — is rolled with real randomness (Web Crypto) and stored as segments. Clients never recompute a blob's life; they play back the stored segments, each carrying its own 32-bit `rng` so the walk inside it replays identically for everyone watching. Randomness is kept believable by structure, not by determinism: allowed transitions (a blob wakes before doing anything else), minimum durations, slow-moving energy and mood, and relationship axes that move by a capped step per meeting. The one thing still derived from the seed is a blob's look, because that is its identity.

## Self-hosted: Node and Postgres in Docker, not Cloudflare

The garden's server used to be a Cloudflare Worker, each region in its own Durable Object and accounts in D1. It tied the garden to one provider and never got deployed. It is now a plain Node service (Hono, as before) on Postgres, shipped as a Docker image with a `docker compose` file, so it runs anywhere a container does. Drizzle is its ORM: the schema is TypeScript (`src/schema.ts`), migrations are generated from it and applied as each server starts, and its `sql` tag covers the two queries an ORM says badly (the family tree's recursion, the journal's union). Everything is one database, so a birth takes its name in the same transaction as the step that makes it, and a sign-up creates the account and its blob at once, with nothing to undo.

## One writer per region: a row lock, and steps any server can claim

Every region lives itself forward every 5 minutes, 30 minutes ahead of now so clients always have something to play. Each server looks every second for regions whose `next_step_at` has passed and claims them (`FOR UPDATE SKIP LOCKED`, moving the next step on as it claims), so any number of servers share the stepping and each region is stepped by one. The step runs in one transaction that holds the region's row: no two steps can roll the same stretch of time differently, and changes a player makes (which lock the region's row first, as the step does, so the two can't deadlock) wait for it. If a step fails, nothing of it is kept, and the next claim a period later lives the same stretch. A garden that was asleep longer than 2 days skips the gap instead of living it. Each server keeps a view of the regions players ask for, rebuilt when the region's `version` moves (one indexed read per request tells), so servers need nothing from each other. Past what one Postgres takes, the tables split by region (partitioning, or one database per group of regions) without the code changing its queries.

## Walks follow the terrain, at a walking pace

The sim picks points without knowing the terrain, and the renderer routes every walk round lakes, rivers and cliffs. A walk's duration therefore comes from the route's length, not the straight line, or a blob crossing a lake would hurry along its banks. On a big island an explore spreads its stops along the route to its end point (each a little off it, and only where a straight walk reaches), so its last leg never dashes across the map, and the gait thresholds (walk, hop) are per tile like the walks themselves. All of it is playback: nothing stored changes.

## Relationships gate interactions

Each pair has friendship, romance and tension, plus a chemistry rolled once when they first meet. The status (friends, best friends, crush, lovers, complicated, rivals, ex, family…) is read off those with hysteresis, and the status decides which interactions are even possible — rivals argue, sulk or ignore each other; they never hug. Romance only grows between blobs mutually attracted to each other's sex, never within a family, and only between grown-ups.

Meetings can grow into gatherings of up to five: company is picked by how well a blob gets on with everyone already there and by how close they stand, so blobs gather with their neighbours. A group does one thing together (chat, play, dance) and every pair in it still has its own moment — pairs whose status rules that out (rivals, exes) bicker or snub each other instead. Bonds move slower in a crowd, and children only come from a couple alone together.

## Character colours relationships, without deciding them

A personality is eight axes in [0, 1]: sociability, temper, playfulness, romance, chronotype, kindness, loyalty and curiosity. The app describes a blob by its two most marked axes (`character`), so every combination reads as its own character rather than one of a few fixed types; chronotype is a habit, not character, and stays out of it. Axes added later are rolled from the blob's seed when a stored personality lacks them (`personalityOf`), so old blobs get a stable, varied value with no migration.

Character tilts the odds, never the rules: a pair's chemistry is still mostly luck, with their affinity (alike in play and company, not two hot tempers, kindness on either side) tipping it. Romantics fall a little sooner and loyal blobs want more friendship first; loyal couples weather more before breaking up. A blob spoken for flirts much less the more loyal it is, and when it does, word gets around: its sweetheart's tension rises, more for a loyal one. Each blob keeps one best friend (two if very sociable): a new one takes the place of the weakest only once it's the closer friendship. Any tuning is held to `balance.test.ts`, a month of three gardens that must stay believable.

Some moments only happen when they fit, so they mean something when they do: a blob comforts a friend who's low (the kinder, the likelier), confesses only once a crush runs deep, shows off a find only right after finding it, and naps against a sweetheart, best friend or family only when both are flagging. Teasing goes both ways: banter between friends, a jab between rivals. Every blob's character is served with it, as it's shown in the app; the player sets their own whole (`PATCH /me/personality`), since a character half chosen is no one's. They shape it in Settings, one slider per axis, with the name it reads as shown live; joining the garden carries the private blob's character over, so it's the same blob in both places. Character names are noun phrases ("Heart of gold & joker"), so French needs no agreement with a blob's sex.

## Couples form and break up; children grow up

A union starts when a relationship is in love enough, and ends when the couple breaks up (they become exes), not at a birth. Children can be born while a couple is together, after a cooldown, less often as the garden fills up. Children grow up after 8–12 days and can then fall in love and have children of their own; unions are between blob seeds, not accounts, for that reason.

## Sex and attraction are the player's choice

A blob is female, male or neither, and is drawn to women, men or anyone. The player picks both for their own blob (and can change them, in the settings); children roll theirs at birth. A blob with no sex draws only those drawn to anyone. The sex shows as a sign on the blob — a bow or a bowler hat — measured onto its silhouette, since blobs come in ten shapes.

A change the blob's couple can't survive (they're no longer drawn to each other) breaks it up at once, as exes, and any romance it can no longer feel fades; the settings say so before it's saved. Nothing else is taken back: friendships, family and history stay.

## Hidden means hidden everywhere

An account can hide from the garden. Its seed is its normalized pseudo, so hiding its name alone would hide nothing: a hidden account is left out of everything anyone else is sent — the region's blobs, as someone's partner, from meetings' `with`, from the news, the family tree (its children show with one parent) and relationships. Its own player still sees it whole (`/tree` and `/blobs/:seed/relationships` take an optional token for that).

## Deleting an account deletes the blob, not its children

Deleting an account (with its password again) takes its blob out of the garden with its pseudo, timeline, meetings and relationships, and ends its couple. Its children are the garden's too, so they stay, with their other parent: the unions they were born to keep a placeholder seed no one can take, so a new account with the same pseudo inherits nothing. The private island stays on the device.

## Languages: typed dictionaries, no library

Every word the app shows is in `apps/desktop/src/i18n`, one file per language. `en.tsx` is the source and every other language is typed as its `Messages`, so a missing line fails the typecheck rather than showing up blank. Lines that depend on a name or a number are functions, which covers plurals and word order per language without a message syntax; dates, times, lists and country names come from `Intl` in the language on screen. The sim stores facts, never sentences (a journal entry is a segment, a find is its English key), and the app words them. It starts from the system's language and the choice is saved with the rest of the app's state.

## UTC everywhere

All timestamps are epoch milliseconds, and time-of-day logic (the pull of night toward bed, the sky's daylight) operates in UTC, the same on the desktop client and the server regardless of the user's local timezone.

## Account seed can differ from the local blob's seed

A collision on the pseudo used for the private, local-only blob shouldn't block joining the garden. When the exact local pseudo is already registered as an account, the API suggests deterministic variants (`pseudo2`, `pseudo3`, ...) and the user picks one for the account only. The private blob keeps its original seed unchanged — the two are shown as visually distinct blobs, the account presented as a "sprout" of the private one, not a synchronized copy.

## A dev panel, client side only

In `dev`, a box over the scenes tunes the clock speed, the sky, blob size and reduced motion while the app runs. Everything goes through one small store (`lib/dev.ts`): the scenes read the dev clock instead of `Date.now()` and the sky through `skyAt`, so with the knobs untouched, or in a build, nothing changes. It only bends what the client plays back: the private blob lives further ahead as the clock speeds up, but the garden can't outrun the segments the server sent, so there the box asks the server instead (`POST /__dev/time-scale`, `DEV_TOOLS=1`): the garden's clock is the server's. A new speed steps every region at once, or blobs would run out of timeline while waiting for a step spaced out at the old one. Once changed live, the anchored clock stays in charge even back at 1x, so the garden never jumps back in time. The one way back is the box's reset: it empties the database (`/__dev/reset`), puts the clock back to real time and seeds a garden, and the app forgets its saved state (a file holding `null`) to start over. The panel isn't translated, since no player sees it.

## The whole sprite pack, each piece picked from the neighbours

Every piece of Zagorskiy's pack is in `assets/iso`, exported at 2x from its SVG on the shared block canvas, and the renderer picks it from the cells around (`cellStack` in `world.ts`); nothing new is stored. Rivers open onto every neighbour that is water, and drop the nub of bank in a corner where the cell across it is water too, so a wide river or a pool reads as one sheet. In the snow, a river touching ice freezes over. A river heading straight into a flat road runs under it through a culvert, and a bridge is the pack's own deck, narrow or wide, painted with the editor's bridge tool. A river needs no ramp to fall: wherever it meets more river a block up it comes down as a waterfall (`rampDirection`). A lake and the sea take the same banked pieces where they meet land, so coasts and shores are rounded, as in the pack's own scenes. A grass, sand or snow ramp with two neighbours a block up is drawn as an inside corner, and one with only the cell across a corner up as an outside corner, and `surfaceHeight` follows those shapes; but an inside corner is still walked up its first side only, as before, because every client lays the garden out itself and a change to `canStep` would reshape it for everyone. Road bends come rounded or square, picked by the cell's place so they never flicker. The clouds are the pack's eight, grey over a mostly snowy island.

The garden is laid out by biome, a deliberate change for every client at once (its pinned hash moved with it). The four roads from the village run to the sea and split the island into quarters, one biome each: the mountain at the back, the desert on the right, the meadow in front, the forest on the left. Every size is a fraction of the island's, so a bigger garden has bigger biomes, not more of them. Only the mountain has height: rounded-square terraces that come down short of the roads, the village and the beach, so there are no lone bumps in the plains and no random slopes to reach anything. A road climbs it a slope per terrace to a frozen tarn on top, and the river leaves the tarn down waterfalls between slopes, under the west road through a culvert, through a lake in the forest and out by a wide mouth under a broad bridge. Nests go as near the village as they fit, keeping their distance.
