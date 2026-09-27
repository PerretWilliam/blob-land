# Decisions

Lightweight log of decisions already made, one paragraph each. This is a flat list, not a changelog.

## Local-first before account

The app is usable with zero network calls and no account: on first launch, picking a pseudo creates a local blob (seed, simulated state, journal) entirely offline. "Join the garden" is a separate, explicit action, not a gate the user has to pass before seeing their blob.

## Children are first-class blobs, not sub-records of their parents

A child born from a union gets its own row in the `blobs` table, addressable and displayable independently of the union or its parents. There's no ownership relationship — a child isn't "attached" to an account.

## Random, stored, played back — not deterministic

Blobs used to be a formula of (seed, time): the same inputs always gave the same day, which made them predictable. Now every choice — when to sleep, where to walk, who to meet, how it goes — is rolled with real randomness (Web Crypto) and stored as segments. Clients never recompute a blob's life; they play back the stored segments, each carrying its own 32-bit `rng` so the walk inside it replays identically for everyone watching. Randomness is kept believable by structure, not by determinism: allowed transitions (a blob wakes before doing anything else), minimum durations, slow-moving energy and mood, and relationship axes that move by a capped step per meeting. The one thing still derived from the seed is a blob's look, because that is its identity.

## One writer per region: its own object, on its own alarm

Each region of the garden lives whole in its own Durable Object, in that object's SQLite, and lives itself forward on its own alarm every 5 minutes, 30 minutes ahead of now so clients always have something to play. Requests only read, and an object runs one thing at a time, so no two steps can roll the same stretch of time differently, with no locking. A step is written in one transaction: if it fails, nothing of it is kept, the runtime retries it, and the next one lives the same stretch; the cron only sets again an alarm that stopped for good. A garden that was asleep longer than 2 days skips the gap instead of living it. D1 keeps only what regions share (accounts, the directory of blobs and their names), so no single database takes every region's writes, and the garden grows by adding regions.

## Relationships gate interactions

Each pair has friendship, romance and tension, plus a chemistry rolled once when they first meet. The status (friends, best friends, crush, lovers, complicated, rivals, ex, family…) is read off those with hysteresis, and the status decides which interactions are even possible — rivals argue, sulk or ignore each other; they never hug. Romance only grows between blobs mutually attracted to each other's sex, never within a family, and only between grown-ups.

Meetings can grow into gatherings of up to five: company is picked by how well a blob gets on with everyone already there and by how close they stand, so blobs gather with their neighbours. A group does one thing together (chat, play, dance) and every pair in it still has its own moment — pairs whose status rules that out (rivals, exes) bicker or snub each other instead. Bonds move slower in a crowd, and children only come from a couple alone together.

## Couples form and break up; children grow up

A union starts when a relationship is in love enough, and ends when the couple breaks up (they become exes), not at a birth. Children can be born while a couple is together, after a cooldown, less often as the garden fills up. Children grow up after 8–12 days and can then fall in love and have children of their own; unions are between blob seeds, not accounts, for that reason.

## Sex and attraction are the player's choice

A blob is female, male or neither, and is drawn to women, men or anyone. The player picks both for their own blob (and can change them); children roll theirs at birth. A blob with no sex draws only those drawn to anyone. The sex shows as a sign on the blob — a bow or a bowler hat — measured onto its silhouette, since blobs come in ten shapes.

## UTC everywhere

All timestamps are epoch milliseconds, and time-of-day logic (the pull of night toward bed, the sky's daylight) operates in UTC, the same on the desktop client and the Worker regardless of the user's local timezone.

## Account seed can differ from the local blob's seed

A collision on the pseudo used for the private, local-only blob shouldn't block joining the garden. When the exact local pseudo is already registered as an account, the API suggests deterministic variants (`pseudo2`, `pseudo3`, ...) and the user picks one for the account only. The private blob keeps its original seed unchanged — the two are shown as visually distinct blobs, the account presented as a "sprout" of the private one, not a synchronized copy.
