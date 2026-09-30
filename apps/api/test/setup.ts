import { sql } from "drizzle-orm";
import { db, migrate } from "../src/db";

// Every run starts from an empty garden, on the schema production runs. Only
// ever on a database meant for it: this drops everything in it.
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("tests only run on a database whose name ends in _test");
await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public`);
await migrate();
