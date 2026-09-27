# @blob-land/api

Cloudflare Worker (Hono): server-authoritative accounts, presence, unions, and births.
Each region of the garden is a Durable Object (`src/region.ts`) holding it in
its own SQLite and living it forward on its own alarm; D1 holds accounts and
the blob directory (`migrations/`).

```bash
pnpm --filter @blob-land/api db:apply   # D1 migrations, local
pnpm --filter @blob-land/api dev
pnpm --filter @blob-land/api test
```

A local database from before regions had their own objects can't be
migrated: delete `apps/api/.wrangler/state`, then `db:apply` and `seed`.

## A lively local garden

```bash
pnpm --filter @blob-land/api seed 20   # register 20 random blobs and run a world step
```

`seed` and `load` use dev-only routes (`/__dev/*`), open only with
`DEV_TOOLS=1` in `apps/api/.dev.vars`. Never set it in production.

To watch relationships unfold in minutes instead of days, speed the garden's
clock up: add `TIME_SCALE=60` to `apps/api/.dev.vars` (a garden day then lasts
24 minutes; 10 is easier to follow) and restart `pnpm dev`. The desktop app
reads the rate from `/garden` and plays everything back at that speed.
Changing the scale carries on from the garden's current time; going back to
real time (removing it) leaves blobs lived ahead, so reset the local database:
delete `apps/api/.wrangler/state`, then `db:apply` and seed again.

## Load test

```bash
pnpm --filter @blob-land/api load [blobs=10000] [clients=20] [requests=600]
```

Fills the running local API with blobs, lives every region, then asks for
`/garden` whole and with `since`, and prints latency percentiles. Results are
in [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).

## Deploying

```bash
wrangler d1 migrations apply blob-land --remote   # before the code that needs them
wrangler deploy
```

Errors from requests and steps are logged whole (`console.error`, JSON), kept
by Workers Logs (`[observability]` in wrangler.toml): search for
`request_failed`, `step_failed` or `wake_failed`.

## Backups and restoring

Both stores keep their own point-in-time history; nothing to schedule.

- **D1** (accounts, directory): Time Travel, 30 days back.
  `wrangler d1 time-travel info blob-land --timestamp <ISO time>` shows the
  bookmark, `wrangler d1 time-travel restore blob-land --timestamp <ISO time>`
  restores it.
- **A region** (its Durable Object's SQLite): point-in-time recovery, 30 days
  back, from inside the object. There's no route for it yet; in an incident,
  deploy one (behind a secret) that runs, in the `Region` object:

  ```ts
  const bookmark = await this.ctx.storage.getBookmarkForTime(Date.parse("<ISO time>"));
  await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
  this.ctx.abort(); // restarts the object on the restored data
  ```

  Restoring a region and D1 to the same moment keeps them in step; a region
  restored alone may hold names the directory has moved on from. Players'
  apps notice the step number going back and fetch the region whole again.
