# @blob-land/api

Cloudflare Worker (Hono + D1): server-authoritative accounts, presence, unions, and births.

```bash
pnpm --filter @blob-land/api dev
pnpm --filter @blob-land/api test
pnpm --filter @blob-land/api db:apply
```

## A lively local garden

```bash
pnpm --filter @blob-land/api seed 20   # register 20 random blobs and run a world step
```

To watch relationships unfold in minutes instead of days, speed the garden's
clock up: add `TIME_SCALE=60` to `apps/api/.dev.vars` (a garden day then lasts
24 minutes; 10 is easier to follow) and restart `pnpm dev`. The desktop app
reads the rate from `/garden` and plays everything back at that speed.
Changing the scale carries on from the garden's current time; going back to
real time (removing it) leaves blobs lived ahead, so reset the local database:
delete `apps/api/.wrangler/state`, then `db:apply` and seed again.
