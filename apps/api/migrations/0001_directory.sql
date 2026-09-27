-- D1 holds what the whole garden shares: accounts, and a directory of every
-- blob. Everything blobs do (their timelines, relationships, couples, births)
-- lives in their region's Durable Object (src/region.ts), which steps and
-- serves it on its own. Apply with `pnpm db:apply` (wrangler d1 migrations).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  pseudo TEXT NOT NULL,
  seed TEXT NOT NULL UNIQUE, -- normalizeSeed(pseudo), from blobatar
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL, -- epoch ms
  created_at INTEGER NOT NULL
);

-- Every blob, an account's own (owner_user_id set) or one born in the garden:
-- which region it lives in, and the name it holds. Pseudos and children's
-- names are one namespace, and name_key (normalizeSeed of either) is its one
-- UNIQUE key, so a sign-up and a birth can never take the same name.
CREATE TABLE blobs (
  seed TEXT PRIMARY KEY,
  owner_user_id TEXT UNIQUE REFERENCES users(id),
  name_key TEXT NOT NULL UNIQUE,
  region INTEGER NOT NULL,
  born_at INTEGER NOT NULL -- children are listed ahead of their birth: the step lives ahead
);
CREATE INDEX blobs_region ON blobs(region, born_at);
