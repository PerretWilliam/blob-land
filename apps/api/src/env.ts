export interface Env {
  DB: D1Database;
  AUTH_RATE_LIMITER: RateLimit;
  JWT_SECRET: string;
}
