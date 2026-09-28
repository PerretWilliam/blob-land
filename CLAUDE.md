# Blob Land

A cozy desktop life sim: a blob (drawn by [blobatar](https://blobatar.dev) from
its name) lives a life of its own that the player watches but never steers. It
lives on a private island (local, offline, no account) and, once the player
joins, in the shared garden (server-simulated regions everyone sees alike).

## Language

All code, comments, commit messages, PRs and docs in this repo are in
**English**, whatever language the conversation is in. The app's text is
English too.

## Structure

- `apps/desktop`: Tauri 2 + React/Vite/TS. The world is drawn with PixiJS
  (WebGL) in `src/components/world.ts`, driven by `src/components/scene.tsx`.
  Every server call goes through `src/lib/api.ts`.
- `apps/api`: Cloudflare Worker (Hono). Each region of the garden lives whole in
  its own Durable Object (`src/region.ts`, SQLite, stepped on its own alarm);
  D1 only holds what regions share (accounts, the blob directory).
- `packages/sim`: the simulation, pure TypeScript, shared by both. No DOM or
  Node APIs in it: only Web Crypto (declared in `src/env.d.ts`).

## Docs: read before, update after

| File | What it holds | Update it when |
| --- | --- | --- |
| `CONTRIBUTING.md` | **The Blob Land way** (the 10 rules of the game), setup, PR checklist | A rule or the workflow changes (rules change only if the maintainer asks) |
| `docs/DECISIONS.md` | Why things are the way they are, one paragraph each | A design decision is made or reversed |
| `docs/ARCHITECTURE.md` | Stack, data model, what's delivered | The data model, stack or a major feature changes |
| `docs/PERFORMANCE.md` | Frame-rate targets, the bench, measurements | Rendering or the sim's cost changes: measure with the bench and add the numbers |
| `CREDITS.md` | Every third-party lib, font and asset, with its license | A dependency, font or asset is added or removed |
| `README.md` | The public face: what the game is, how it's built | A player-visible feature or the setup changes |
| `apps/*/README.md`, `packages/sim/README.md` | Package-specific commands | A package's commands change |
| `.changeset/*.md` | The changelog to be | **Every** change users or other packages would notice: `pnpm changeset` (one short paragraph, from a player's point of view) |

## The rules of the game

Every change keeps to **The Blob Land way** in `CONTRIBUTING.md`. The ones most
easily broken by accident:

- Blobs are never steered by the player; the player shapes the world around them.
- Nothing punishes being away; nothing is for sale; players never reach each other directly.
- The garden is server-authoritative: clients only play back stored segments.
- The private island works with no network. Anything online fails kindly.
- A blob's look comes from its name and never changes. Names are 16 characters at most (`MAX_NAME_LENGTH` in the sim).

## How to work here

- **Keep it simple.** The smallest change that works, matching the code around
  it (naming, comment density, idioms). Fix the root cause, where every caller
  goes through.
- **Commits:** Conventional Commits, lowercase subject (commitlint rejects
  sentence case), e.g. `feat(desktop): ...`, `fix(garden): ...`. No
  attribution lines in commits or PRs.
- **Branches and PRs:** work on a branch, open a PR against `main`. `main` is
  protected (PR + the `check` CI job). Never merge or enable auto-merge unless
  the maintainer asks.
- **Before a PR:** `pnpm typecheck` and `pnpm test` at the root, a changeset
  if needed, and the docs above.
- **UI changes:** check them in the running app (the Browser pane can load the
  Vite server, `desktop-vite` in `.claude/launch.json`; Tauri APIs aren't there,
  so the app believes it's offline). Share a screenshot.

## Watch out for

- **Look and feel:** the cartoon theme lives in `apps/desktop/src/index.css`
  (`--ink`, `--sky`, `--sun`, `--grass`, `--berry`; `.toon` cards, `.toon-input`,
  `.toon-title`, `.toon-outline`) and in `components/ui/button.tsx`. Reuse them;
  never add a second style. Fredoka is the only font.
- **Errors and empty states:** server errors become player-friendly text in
  `request()` (`lib/api.ts`, `FRIENDLY`); an unreachable server is
  `ApiError.offline`. Panels use `EmptyState` / `LoadFailed`
  (`components/empty-state.tsx`); the app knows reachability from `useOnline()`.
  Never show raw server messages or stack traces to players.
- **Performance:** the garden holds up to 450 blobs per island. Anything in the
  frame loop (`scene.tsx`) or the world renderer must stay cheap; run the bench
  (`pnpm --filter @blob-land/desktop bench`) for rendering changes.
- **Time:** everything is epoch milliseconds, UTC. The garden's clock can run
  faster in dev (`TIME_SCALE`); use `gardenTime(clock)`, not `Date.now()`, for
  garden time.
- **Randomness:** the sim rolls real randomness and stores the results; tests
  pin an rng where they can. Joining the garden steps with real randomness, so
  tests about outcomes must leave room for it.
- **Branding:** the icon, banner and menu island are generated by
  `pnpm --filter @blob-land/desktop brand` (needs `rsvg-convert` and the Fredoka
  font installed), then `pnpm tauri icon brand/icon.png` in `apps/desktop` for
  the platform icons (don't commit its `android/`, `ios/` or `64x64.png` output).
- **Third-party assets:** the iso sprite pack (`apps/desktop/src/assets/iso`,
  by Zagorskiy) can be used here and in other projects as content files, but
  never redistributed, re-packaged or sold on its own or as an asset
  collection (see its `LICENSE.txt`). Credit anything new in `CREDITS.md`.
- **License:** PolyForm Noncommercial 1.0.0 plus additional terms (`LICENSE`).
  Don't call the project "open source" or MIT.
- **CI minutes:** the repo is private, so Actions minutes are limited, and
  macOS minutes count ten times. `ci.yml` (Linux) runs on PRs; the three-system
  Tauri build (`build.yml`) runs only on release tags or by hand. Don't widen
  what triggers it.
- **Versioning:** Changesets. `release.yml` opens a "Version Packages" PR on
  every push to `main`; merging it versions and tags every package
  (`@blob-land/desktop@x.y.z`, `privatePackages.tag`). The app's version follows
  `apps/desktop/package.json` (`tauri.conf.json` points at it). Never bump
  versions by hand.
- **Dev quirks:** in `pnpm dev`, the Dock shows the app as `blob-land-desktop`
  (an unbundled binary); a bundled build shows "Blob Land". The API's tests use
  `@cloudflare/vitest-pool-workers` with vitest 4 (`cloudflareTest` plugin,
  files run one at a time, test bindings typed via `Cloudflare.Env`).
- **Deploying the API** isn't set up yet (D1 `database_id` is `REPLACE_ME`,
  `JWT_SECRET` is a secret): don't deploy without the maintainer.
