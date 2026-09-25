# Architecture

## Stack

- **apps/desktop** — Tauri (Rust shell) wrapping a React + Vite + TypeScript UI, styled with Tailwind CSS and shadcn/ui components. Talks to `apps/api` through `@tauri-apps/plugin-http`, which issues requests from the Rust side rather than the webview.
- **apps/api** — a Cloudflare Worker built on Hono, backed by a D1 (SQLite) database. Server-authoritative over accounts, presence, unions, and births; the client never sends computed state, only actions.
- **packages/sim** — a pure TypeScript simulation engine with no I/O, imported by both `apps/desktop` and `apps/api`. It's the single source of truth for a blob's deterministic behavior: daily schedule, expression/state at a given timestamp, journal entries, love chance, and child trait inheritance. Determinism comes from seeding a hash function with the blob's seed and the relevant timestamp, so the same inputs always produce the same output on both sides.

## Data model

Three tables in D1 (`apps/api/schema.sql`):

- **users** — one row per account: `id`, `pseudo`, `seed` (normalized pseudo, unique), password hash/salt, `visible_in_garden`, `last_seen_at`, `created_at`.
- **unions** — a pairing between two users: `user_a`/`user_b` (ordered, `user_a < user_b`), `started_at`, `ended_at` (`NULL` while active), and `child_traits` (frozen JSON, written lazily once a child is born). A partial unique index enforces at most one active union per member.
- **blobs** — every blob that isn't an account: `seed` (primary key), `traits` (frozen JSON, never recomputed), `parent_union_id` (`NULL` for a seed-only blob with no parents), `born_at`. Children born from a union are first-class rows here, not sub-records of their parents.

## Delivered so far

1. Simulation engine (`packages/sim`): deterministic schedule, state, journal, and trait inheritance.
2. API worker (`apps/api`): accounts, presence, garden listing, union pairing, and lazy birth resolution.
3. Desktop wiring (`apps/desktop`): auth, garden screen rendering blobs via `stateAt`, visibility toggle, presence ping, tray notifications for journal events.
4. Garden performance: viewport-gated animation, client-side pagination, `prefers-reduced-motion` support.
5. Local-first onboarding: a pseudo is picked locally with no account or network call; joining the garden is an explicit, separate action that can assign the account a different seed than the private blob if the chosen pseudo collides with an existing one.
