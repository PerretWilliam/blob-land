# Architecture

## Stack

- **apps/desktop** — Tauri (Rust shell) wrapping a React + Vite + TypeScript UI, styled with Tailwind CSS and shadcn/ui components. Talks to `apps/api` through `@tauri-apps/plugin-http`, which issues requests from the Rust side rather than the webview.
- **apps/api** — a Cloudflare Worker built on Hono, backed by a D1 (SQLite) database. Server-authoritative over accounts and the whole garden: a cron trigger runs the world step every 5 minutes and stores what every blob does; requests only read it. The client never sends computed state, only actions.
- **packages/sim** — a pure TypeScript simulation engine with no I/O, imported by both `apps/desktop` and `apps/api`. `stepWorld` lives a set of blobs forward at random — segments of sleep, rest, exploring, discoveries and meetings; relationships, couples, breakups and births — taking an injected `Rng` so tests can pin it. Playback helpers (`positionOn`, `legIn`, `segmentAt`) turn stored segments back into where a blob stands at any instant.

## Data model

D1 (`apps/api/schema.sql`):

- **users** — one row per account: `id`, `pseudo`, `seed` (normalized pseudo, unique), password hash/salt, `visible_in_garden`, `last_seen_at`, `created_at`.
- **blobs** — every living blob: an account's own (`owner_user_id`) or one born in the garden (`parent_union_id`, frozen `traits`, `name`). Each carries its identity (`sex`, `attraction`), `personality`, `born_at`/`adult_at`, `energy`/`mood`, and `last` — its latest segment, where the world step picks up.
- **unions** — couples between two blob seeds (`seed_a < seed_b`), `started_at`, `ended_at` (`NULL` while together), `last_birth_at`. A partial unique index keeps one active union per blob.
- **segments** — the played-back timeline, a few days of it: activity, expression, end point, replay `rng`, who with, what was found.
- **relationships** — per pair: friendship, romance, tension, chemistry, status, kin, ex, meetings.
- **interactions** — each meeting: kind, outcome, the axis changes it made.

The private blob's life is lived the same way on the device (`apps/desktop/src/lib/life.ts`) and stored in the app's `state.json`.

## Delivered so far

1. Simulation engine (`packages/sim`): deterministic schedule, state, journal, and trait inheritance.
2. API worker (`apps/api`): accounts, presence, garden listing, union pairing, and lazy birth resolution.
3. Desktop wiring (`apps/desktop`): auth, garden screen rendering blobs via `stateAt`, visibility toggle, presence ping, tray notifications for journal events.
4. Garden performance: viewport-gated animation, client-side pagination, `prefers-reduced-motion` support.
5. Local-first onboarding: a pseudo is picked locally with no account or network call; joining the garden is an explicit, separate action that can assign the account a different seed than the private blob if the chosen pseudo collides with an existing one.
6. Living world: random, stored lives played back by clients; relationships that gate interactions; couples, breakups, births and children growing up; sex and attraction, with a sign on every blob.
