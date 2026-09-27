import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

// The tests start from the same D1 migrations production runs (test/setup.ts applies them).
const migrations = await readD1Migrations("./migrations");

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        // Region objects keep their data in SQLite, which isolated storage can't
        // stack; the tests share one garden from start to end anyway.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        // Real time, whatever .dev.vars speeds the local garden up to.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, DEV_TOOLS: "1", TIME_SCALE: "1" } },
      },
    },
  },
});
