import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The tests start from the same D1 migrations production runs (test/setup.ts applies them).
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // Real time, whatever .dev.vars speeds the local garden up to.
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, DEV_TOOLS: "1", TIME_SCALE: "1" } },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    // The tests share one garden from start to end: one file at a time, in order.
    fileParallelism: false,
  },
});
