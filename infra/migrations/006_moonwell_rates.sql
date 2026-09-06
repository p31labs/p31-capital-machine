CREATE TABLE IF NOT EXISTS moonwell_rate_observations (
  address TEXT PRIMARY KEY,
  stored TEXT NOT NULL,
  ts INTEGER NOT NULL,
  bucket INTEGER NOT NULL DEFAULT 0
);
