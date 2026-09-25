-- D1 schema for Blob's garden backend (apps/api).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  pseudo TEXT NOT NULL,
  seed TEXT NOT NULL UNIQUE, -- normalizeSeed(pseudo), from blobatar
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  visible_in_garden INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER NOT NULL, -- epoch ms
  created_at INTEGER NOT NULL
);

CREATE TABLE unions (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id),
  user_b TEXT NOT NULL REFERENCES users(id), -- user_a < user_b, enforced by the pairing code, not SQL
  started_at INTEGER NOT NULL,
  ended_at INTEGER, -- NULL while active; no death in the concept, but a union can end
  child_traits TEXT, -- frozen JSON childTraits() result, written lazily at birth
  UNIQUE (user_a, user_b, started_at)
);

-- One active union per member: at most one row with ended_at IS NULL per user.
CREATE UNIQUE INDEX unions_active_a ON unions(user_a) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX unions_active_b ON unions(user_b) WHERE ended_at IS NULL;

CREATE TABLE blobs (
  seed TEXT PRIMARY KEY,
  traits TEXT NOT NULL, -- frozen JSON, never recomputed once written
  parent_union_id TEXT REFERENCES unions(id), -- NULL for an account/seed-only blob
  born_at INTEGER NOT NULL
);
