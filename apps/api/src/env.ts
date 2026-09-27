import type { Region } from "./region";

export interface Env {
  DB: D1Database;
  /** One object per region, holding and living it (src/region.ts). */
  REGION: DurableObjectNamespace<Region>;
  AUTH_RATE_LIMITER: RateLimit;
  JWT_SECRET: string;
  /** Local dev only: how many times faster than real time the garden runs (see clock.ts). */
  TIME_SCALE?: string;
  /** Local dev only: "1" opens the /__dev routes (index.ts). Never set in production. */
  DEV_TOOLS?: string;
}
