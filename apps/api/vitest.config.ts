import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A Postgres of its own: `docker compose up -d db` makes blob_land_test,
    // CI runs one as a service. test/setup.ts empties it first.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://blob:blob@localhost:5432/blob_land_test",
      JWT_SECRET: "test-secret",
      DEV_TOOLS: "1",
      AUTH_RATE_LIMIT: "1000",
      // Behind a proxy, as a real server would be: X-Forwarded-For is read (test/integration.test.ts, "security").
      TRUST_PROXY: "1",
    },
    setupFiles: ["./test/setup.ts"],
    // The tests share one garden from start to end: one file at a time, in order.
    fileParallelism: false,
  },
});
