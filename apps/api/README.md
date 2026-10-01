# @blob-land/api

The garden's server: a Node service (Hono) on Postgres, with Drizzle as its
ORM. Server-authoritative over accounts and the whole garden, which is split
into regions: every server steps the regions that are due (claimed in
Postgres, so any number of servers can run side by side) and answers
players from a view of each region it keeps until the region changes.

- `src/schema.ts`: every table (Drizzle). Change it, then `pnpm db:generate`
  writes the migration into `migrations/`; servers apply new ones as they start.
- `src/app.ts`: the routes. `src/region.ts`: stepping and the cached views.
  `src/garden.ts`: a step and the region's reads. `src/main.ts`: the server.

## Running it locally

```bash
cp apps/api/.env.example apps/api/.env          # once
docker compose -f apps/api/docker-compose.yml up -d db   # Postgres, and a test database
pnpm --filter @blob-land/api dev
pnpm --filter @blob-land/api test
```

## Self-hosting

Everything it needs is in `docker-compose.yml`: Postgres and the API, built
from the repo root.

```bash
cd apps/api
JWT_SECRET=$(openssl rand -hex 32) POSTGRES_PASSWORD=$(openssl rand -hex 16) docker compose up -d --build
```

Keep both secrets somewhere (an `.env` file next to `docker-compose.yml`
works): a new `JWT_SECRET` logs every player out, and `POSTGRES_PASSWORD` only
applies when the database is first created. Put a reverse proxy with TLS
(Caddy, nginx, Traefik) in front of port 8787 and set `TRUST_PROXY=1` so
sign-up limits count players' own addresses. Every setting is listed in
`.env.example`.

To take more players, run more API containers (on this machine or others)
with the same `DATABASE_URL` and `JWT_SECRET`, behind a load balancer: they
share the stepping between them. `GET /health` answers once the server reaches its
database.

Errors are logged as one JSON line each on stderr (`docker compose logs api`):
search for `request_failed` or `step_failed`.

## Backups and restoring

The garden is the Postgres database, whole: accounts, regions and every
timeline. Back it up with `pg_dump`, for example every night:

```bash
docker compose exec -T db pg_dump -U blob -Fc blob_land > blob_land-$(date +%F).dump
```

and restore into an empty database with `pg_restore -U blob -d blob_land
--clean`. Players' apps notice a region's step number going back and fetch
it whole again.

## A lively local garden

```bash
pnpm --filter @blob-land/api seed 20   # register 20 random blobs and run a world step
```

`seed` and `load` use dev-only routes (`/__dev/*`), open only with
`DEV_TOOLS=1` in `apps/api/.env`. Never set it in production. The desktop's Dev box has a **Reset everything** button on them (`/__dev/reset`): it empties the database and the garden's clock, seeds 16 blobs, and sends the app back to a first start.

To watch relationships unfold in minutes instead of days, speed the garden's
clock up: add `TIME_SCALE=60` to `apps/api/.env` (a garden day then lasts
24 minutes; 10 is easier to follow) and restart `pnpm dev`. The desktop app
reads the rate from `/garden` and plays everything back at that speed.
With `DEV_TOOLS=1`, the desktop's Dev box changes the scale live instead (no restart). Changing the scale carries on from the garden's current time; going back to
real time (removing it) leaves blobs lived ahead, so reset the local
database: `docker compose down -v`, `up -d db` and seed again.

## Load test

```bash
pnpm --filter @blob-land/api load [blobs=10000] [clients=20] [requests=600]
```

Fills the running local API with blobs, lives every region, then asks for
`/garden` whole and with `since`, and prints latency percentiles. Results are
in [docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).
