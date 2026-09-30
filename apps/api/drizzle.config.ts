import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` compares src/schema.ts with migrations/ and writes the
// next migration there; every server applies what's new as it starts (db.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
