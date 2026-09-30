/** The server's settings, from its environment (see .env.example). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see apps/api/.env.example)`);
  return value;
}

/**
 * Signs every session: whoever knows it can sign in as anyone. A short one
 * can be guessed from a single session token, so outside local dev
 * (DEV_TOOLS) it must be long.
 */
function jwtSecret(): string {
  const secret = required("JWT_SECRET");
  if (secret.length < 32 && process.env.DEV_TOOLS !== "1") throw new Error("JWT_SECRET must be at least 32 characters: `openssl rand -hex 32` makes one");
  return secret;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: jwtSecret(),
  port: Number(process.env.PORT ?? 8787),
  /** Connections this server keeps open to Postgres. */
  poolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  /** Sign-ups and logins allowed per IP per minute. Raise it when many players share one address. */
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 20),
  /** Behind a reverse proxy: take the player's IP from X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY === "1",
  /** Local dev only: how many times faster than real time the garden runs (see clock.ts). */
  timeScale: Math.max(1, Number(process.env.TIME_SCALE ?? 1) || 1),
  /** Local dev only: "1" opens the /__dev routes (app.ts). Never set in production. */
  devTools: process.env.DEV_TOOLS === "1",
};
