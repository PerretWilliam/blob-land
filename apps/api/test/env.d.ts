import type { Env as WorkerEnv } from "../src/env";

// What the tests' `env` holds: the Worker's own bindings, plus the migrations
// vitest.config.ts hands over.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}
