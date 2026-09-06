-- Migration 005: Proof of Care Telemetry Schema
-- Adds care-specific tables to the P31 Capital Machine D1 database
-- Part of: CWD-2026-06-29-PH production hardening

-- ============================================================
-- 11. PROOF OF CARE
-- ============================================================

-- Care state: current metrics per identity
CREATE TABLE IF NOT EXISTS care_state (
  public_key_hex TEXT PRIMARY KEY,
  biometric_score REAL NOT NULL DEFAULT 0.1,
  bond_score REAL NOT NULL DEFAULT 0.1,
  ledger_score REAL NOT NULL DEFAULT 0.1,
  composite_score REAL NOT NULL DEFAULT 0.1,
  confidence REAL NOT NULL DEFAULT 0,
  last_update INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Care telemetry: append-only history for audit + replay
CREATE TABLE IF NOT EXISTS care_telemetry (
  id TEXT PRIMARY KEY,
  public_key_hex TEXT NOT NULL,
  biometric_score REAL NOT NULL,
  bond_score REAL NOT NULL,
  ledger_score REAL NOT NULL,
  composite_score REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  signature_hex TEXT NOT NULL,
  nonce TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (public_key_hex) REFERENCES care_state(public_key_hex) ON DELETE CASCADE
);

-- Nonces: single-use replay protection
CREATE TABLE IF NOT EXISTS care_nonces (
  nonce TEXT PRIMARY KEY,
  public_key_hex TEXT NOT NULL,
  used_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

-- Identities: lightweight sovereign identity registry
CREATE TABLE IF NOT EXISTS identities (
  public_key_hex TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 12. EVENTS QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS queue_stats (
  type TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_processed INTEGER
);

-- ============================================================
-- 13. BROWSER RENDERING USAGE (Cloudflare Browser Rendering)
-- ============================================================

CREATE TABLE IF NOT EXISTS browser_usage (
  date TEXT PRIMARY KEY,
  used_minutes REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 14. MODERATION LOGS (Workers AI)
-- ============================================================

CREATE TABLE IF NOT EXISTS moderation_logs (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  flagged BOOLEAN NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT 'allow',
  processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============================================================
-- 15. USAGE METRICS (Free-tier quota tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS usage_metrics (
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  operations INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (date, service)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_care_state_composite ON care_state(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_care_state_confidence ON care_state(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_care_telemetry_identity ON care_telemetry(public_key_hex);
CREATE INDEX IF NOT EXISTS idx_care_telemetry_timestamp ON care_telemetry(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_care_nonces_expiry ON care_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_moderation_flagged ON moderation_logs(flagged, processed_at DESC);
