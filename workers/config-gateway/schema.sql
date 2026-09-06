CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL,
  is_secret INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_category ON app_config(category);

CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  user_did TEXT,
  status INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  latency_ms INTEGER,
  cost_usdc TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON api_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_endpoint ON api_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_usage_did ON api_usage(user_did);
