import type { Region } from "./region";

export interface Env {
  DB: D1Database;
  /** One world-step writer per region (src/region.ts). */
  REGION: DurableObjectNamespace<Region>;
  AUTH_RATE_LIMITER: RateLimit;
  JWT_SECRET: string;
  /** Local dev only: how many times faster than real time the garden runs (see clock.ts). */
  TIME_SCALE?: string;
}
