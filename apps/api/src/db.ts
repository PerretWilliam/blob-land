import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "./env";
import * as schema from "./schema";

export const client = postgres(config.databaseUrl, {
  max: config.poolSize,
  // bigint holds epoch ms and counts, all well within a JS number.
  types: { bigint: { to: 20, from: [20], serialize: (n: number) => String(n), parse: Number } },
  onnotice: () => {},
});

export const db = drizzle({ client, schema });

/** The database, or a transaction in it: whatever a query runs on. */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

// Next to src/ in dev, next to dist/ once built: the same relative path.
const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Brings the database up to date (migrations/, written by `pnpm db:generate`).
 * Every server runs it as it starts: a lock makes the others wait for the
 * first rather than run the same migration twice.
 */
export async function migrate() {
  const conn = await client.reserve();
  try {
    await conn`SELECT pg_advisory_lock(7160617)`;
    await runMigrations(db, { migrationsFolder: MIGRATIONS });
  } finally {
    await conn`SELECT pg_advisory_unlock(7160617)`;
    conn.release();
  }
}

/** Whether a write failed on a unique key: the name was taken in between. */
export const isTaken = (e: unknown) => (e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";
