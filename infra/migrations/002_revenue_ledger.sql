-- Revenue Ledger — Phase 1 Unified Monetization
-- Single append-only sink for all payment sources with SHA-256 chaining.

CREATE TABLE IF NOT EXISTS revenue_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                    -- 'x402' | 'taler' | 'gumroad' | 'btcpay' | 'love'
  payer_did TEXT NOT NULL,
  merchant_did TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,               -- decimal string (preserve precision)
  asset TEXT NOT NULL,                     -- 'USDC' | 'EUR' | 'LOVE'
  metadata TEXT,                           -- JSON: tool_name, endpoint, session_id, rate
  settlement_tx TEXT,                      -- on-chain tx hash
  created_at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE(hash)
);

CREATE INDEX IF NOT EXISTS idx_revenue_source ON revenue_events(source);
CREATE INDEX IF NOT EXISTS idx_revenue_payer ON revenue_events(payer_did);
CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_hash ON revenue_events(hash);
CREATE INDEX IF NOT EXISTS idx_revenue_asset ON revenue_events(asset);

PRAGMA optimize;
