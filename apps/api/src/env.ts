export interface Env {
  DB: D1Database;
  AUTH_RATE_LIMITER: RateLimit;
  JWT_SECRET: string;
  /** Local dev only: how many times faster than real time the garden runs (see clock.ts). */
  TIME_SCALE?: string;
}
