CREATE TABLE IF NOT EXISTS entitlements (
  did TEXT PRIMARY KEY,
  balance_usdc TEXT NOT NULL DEFAULT '0',
  balance_love TEXT NOT NULL DEFAULT '0',
  tier TEXT DEFAULT 'free',
  monthly_allowance_usdc TEXT DEFAULT '0',
  monthly_used_usdc TEXT NOT NULL DEFAULT '0',
  last_updated INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_meter (
  id TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  total_spent_usdc TEXT NOT NULL DEFAULT '0',
  UNIQUE(did, tool_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS tier_limits (
  tier TEXT PRIMARY KEY,
  monthly_allowance_usdc TEXT NOT NULL,
  monthly_calls_per_tool INTEGER NOT NULL,
  burst_multiplier REAL NOT NULL
);

INSERT OR IGNORE INTO tier_limits (tier, monthly_allowance_usdc, monthly_calls_per_tool, burst_multiplier) VALUES
  ('free', '0', '100', '1.0'),
  ('pro', '50', '1000', '2.0'),
  ('enterprise', '500', '10000', '5.0');

CREATE TABLE IF NOT EXISTS consume_tx_log (
  tx_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'consumed',
  created_at INTEGER NOT NULL
);
