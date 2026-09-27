-- D1 schema for Blob's garden backend (apps/api).
-- Everything blobs do is rolled at random by the world step (src/garden.ts,
-- run by cron) and stored here; clients only play it back.

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

-- Couples, between any two grown-up blobs. Lasts until they break up.
CREATE TABLE unions (
  id TEXT PRIMARY KEY,
  seed_a TEXT NOT NULL,
  seed_b TEXT NOT NULL, -- seed_a < seed_b
  started_at INTEGER NOT NULL,
  ended_at INTEGER, -- NULL while together
  last_birth_at INTEGER
);
CREATE UNIQUE INDEX unions_active_a ON unions(seed_a) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX unions_active_b ON unions(seed_b) WHERE ended_at IS NULL;

-- Every living blob: an account's own (owner_user_id set) or one born in the garden.
CREATE TABLE blobs (
  seed TEXT PRIMARY KEY,
  owner_user_id TEXT UNIQUE REFERENCES users(id),
  name TEXT, -- a child's display name; an account's blob goes by the user's pseudo
  -- normalizeSeed(name). Names share one namespace with account pseudos
  -- (users.seed): the API checks both before writing either (see names.ts).
  name_key TEXT UNIQUE,
  traits TEXT, -- frozen JSON look for a child, NULL when the seed draws it
  parent_union_id TEXT REFERENCES unions(id),
  born_at INTEGER NOT NULL,
  adult_at INTEGER NOT NULL,
  sex TEXT NOT NULL, -- female | male | none
  attraction TEXT NOT NULL, -- women | men | any
  personality TEXT NOT NULL, -- JSON
  energy REAL NOT NULL,
  mood REAL NOT NULL,
  last TEXT NOT NULL -- JSON: its latest segment, where the world step picks up
);

-- The played-back timeline, a few days of it (older rows are pruned).
CREATE TABLE segments (
  seed TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  activity TEXT NOT NULL,
  expression TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  rng INTEGER NOT NULL,
  with_seed TEXT,
  detail TEXT,
  PRIMARY KEY (seed, start)
);
CREATE INDEX segments_end ON segments(end);

CREATE TABLE relationships (
  seed_a TEXT NOT NULL,
  seed_b TEXT NOT NULL, -- seed_a < seed_b
  friendship REAL NOT NULL,
  romance REAL NOT NULL,
  tension REAL NOT NULL,
  chemistry REAL NOT NULL,
  status TEXT NOT NULL,
  kin TEXT, -- parent | sibling
  ex INTEGER NOT NULL DEFAULT 0,
  meetings INTEGER NOT NULL DEFAULT 0,
  last_met_at INTEGER,
  PRIMARY KEY (seed_a, seed_b)
);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  seed_a TEXT NOT NULL,
  seed_b TEXT NOT NULL,
  kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  rng INTEGER NOT NULL,
  d_friendship REAL NOT NULL,
  d_romance REAL NOT NULL,
  d_tension REAL NOT NULL
);
CREATE INDEX interactions_end ON interactions(ended_at);
