CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  source_tx_id TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  roi_bps INTEGER,
  result_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  next_rebalance_at INTEGER
);

CREATE TABLE IF NOT EXISTS allocation_results (
  id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  roi_bps INTEGER,
  tx_hash TEXT,
  completed_at INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations(status);
CREATE INDEX IF NOT EXISTS idx_allocations_target ON allocations(target);
CREATE INDEX IF NOT EXISTS idx_allocations_roi ON allocations(roi_bps DESC);
