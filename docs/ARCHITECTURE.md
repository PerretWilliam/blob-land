# Architecture

## Stack

- **apps/desktop** — Tauri (Rust shell) wrapping a React + Vite + TypeScript UI, styled with Tailwind CSS and shadcn/ui components. Talks to `apps/api` through `@tauri-apps/plugin-http`, which issues requests from the Rust side rather than the webview.
- **apps/api** — a Node service built on Hono, on Postgres through Drizzle (ORM and migrations), shipped as a Docker image. Server-authoritative over accounts and the whole garden, which is split into regions: every server claims the regions due for a step (every 5 minutes) and lives each forward in one transaction, and answers players from a view of each region it keeps until the region changes. Servers hold no state of their own, so any number run side by side on one database. The client never sends computed state, only actions.
- **packages/sim** — a pure TypeScript simulation engine with no I/O, imported by both `apps/desktop` and `apps/api`. `stepWorld` lives a set of blobs forward at random — segments of sleep, rest, exploring, discoveries and meetings; relationships, couples, breakups and births — taking an injected `Rng` so tests can pin it. Playback helpers (`positionOn`, `legIn`, `segmentAt`) turn stored segments back into where a blob stands at any instant.

## Data model

One Postgres database (schema in `apps/api/src/schema.ts`, migrations in `apps/api/migrations/`, applied as a server starts). Every table a region's blobs live in carries `region`, and every query about them filters on it.

- **users** — one row per account: `id`, `pseudo`, `seed` (normalized pseudo, unique), password hash/salt, `last_seen_at`, `created_at`.
- **regions** — one row per region: its `population` (kept by a trigger on blobs), how many steps it has lived (`step`), a `version` bumped by every change (servers' cached views check it), when it's next due (`next_step_at`), and its `weather` (JSON: the sim's spells, rolled on by each step; `GET /garden` sends the one on now and those ahead). A player's home island is a region too, with a negative number and its `host` (the player's blob's seed): stepped like any other while someone's on it, and never listed with the garden's.
- **blobs** — every blob: its `region` (where it is now: its garden region, or an island while away, with `away_from`, the garden region it goes back to, and a visitor's `stay_until`), `name` and `name_key` (pseudos and children's names are one namespace, under this one unique key), its account (`owner_user_id`) if it has one, `country` and `visible`, identity (`sex`, `attraction`), `personality` (JSON, eight axes; missing ones are filled from the seed on read), `gait` (picked by the player, null to walk as its character does), `born_at`/`adult_at`, `energy`/`mood`, frozen `traits` and `parent_union_id` for a child, and `last` — its latest segment, where the step picks up.
- **unions** — couples between two blob seeds (`seed_a < seed_b`), `started_at`, `ended_at` (`NULL` while together), `last_birth_at`. A partial unique index keeps one active union per blob.
- **segments** — the played-back timeline, a few days of it: activity, expression, end point, replay `rng`, who with, what was found, and the `step` that wrote it (`/garden?since=`).
- **relationships** — per pair: friendship, romance, tension, chemistry, status, kin, ex, meetings.
- **interactions** — each meeting: kind, outcome, the axis changes it made.
- **milestones** — each blob's album, kept for good: one row per (`seed`, `kind`, `key`), the first time (first friend, each best friend, crush, couple, child and reconciliation, and firsts such as a first kiss or a first snowball fight), with who it was with (`with_seed`). The step offers every candidate and the primary key keeps the first; `GET /me/album` serves the player's own.

Times are epoch milliseconds in `double precision`: the sim's aren't always whole, and a float8 holds any epoch millisecond exactly.

A blob only ever meets its own region's, and children are born into their parents', so a family, its couples and its news never span regions.

The private blob's life is lived the same way on the device (`apps/desktop/src/lib/life.ts`) and stored in the app's `state.json`.

## Delivered so far

1. Simulation engine (`packages/sim`): deterministic schedule, state, journal, and trait inheritance.
2. API server (`apps/api`): accounts, presence, garden listing, union pairing, and lazy birth resolution; self-hosted with Docker and Postgres.
3. Desktop wiring (`apps/desktop`): auth, garden screen rendering blobs via `stateAt`, visibility toggle, presence ping, tray notifications for journal events.
4. Garden performance: viewport-gated animation, client-side pagination, `prefers-reduced-motion` support.
5. Local-first onboarding: a pseudo is picked locally with no account or network call; joining the garden is an explicit, separate action that can assign the account a different seed than the private blob if the chosen pseudo collides with an existing one.
6. Living world: random, stored lives played back by clients; relationships that gate interactions, pair and group moments played in three beats (hello, the moment, goodbye); couples, breakups, births and children growing up; sex and attraction, with a sign on every blob; a character of eight axes that tilts all of it, served with every blob and set by the player for their own (`PATCH /me/personality`); five gaits, from its character or picked by the player (`PATCH /me/gait`); nine seasons by the calendar and a weather rolled and stored with each region's step (the island rolls its own), which tilts what blobs do, opens moments of its own (snowball fights, sheltering from the rain, leaf piles, fireflies…) and is drawn over the world; an album of each blob's big moments (`GET /me/album`); a blob in one place at a time: an account's blob comes home to its island on the server while its player is there online (`/me/island`), with up to five visitors from the garden (`/me/island/guests`), and its journal follows it (`GET /me/journal`).
7. Settings and languages: one screen for the player's blob (sex and attraction), what the garden sees of it, deleting the account, and the app's language (`apps/desktop/src/i18n`: English and French).
