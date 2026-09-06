-- P31 Capital Machine - BTCPay Gateway Schema
-- ============================================================
-- 11. BTCPay GATEWAY
-- ============================================================

CREATE TABLE IF NOT EXISTS btcpay_donations (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL,
  webhook_event TEXT NOT NULL,
  btcpay_data TEXT NOT NULL,
  swept BOOLEAN DEFAULT 0,
  swept_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_btcpay_donations_invoice ON btcpay_donations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_btcpay_donations_store ON btcpay_donations(store_id);
CREATE INDEX IF NOT EXISTS idx_btcpay_donations_swept ON btcpay_donations(swept);
CREATE INDEX IF NOT EXISTS idx_btcpay_donations_created ON btcpay_donations(created_at DESC);
