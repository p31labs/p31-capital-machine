-- P31 Capital Machine - Prediction Market Arbitrage Module
-- Migration 003

-- ============================================================
-- PREDICTION MARKETS
-- ============================================================
CREATE TABLE IF NOT EXISTS prediction_markets (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  question TEXT NOT NULL,
  yes_price REAL,
  no_price REAL,
  volume REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  last_checked INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prediction_markets_platform ON prediction_markets(platform);
CREATE INDEX IF NOT EXISTS idx_prediction_markets_external ON prediction_markets(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_prediction_markets_status ON prediction_markets(status, last_checked);

-- ============================================================
-- ARBITRAGE OPPORTUNITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS prediction_arbitrage_opportunities (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  yes_price REAL NOT NULL,
  no_price REAL NOT NULL,
  sum_price REAL NOT NULL,
  profit_bps INTEGER NOT NULL,
  expected_profit REAL NOT NULL,
  gas_cost REAL,
  net_profit REAL,
  executed BOOLEAN DEFAULT 0,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arb_opportunities_platform ON prediction_arbitrage_opportunities(platform);
CREATE INDEX IF NOT EXISTS idx_arb_opportunities_executed ON prediction_arbitrage_opportunities(executed, created_at);
CREATE INDEX IF NOT EXISTS idx_arb_opportunities_profit ON prediction_arbitrage_opportunities(profit_bps DESC);
