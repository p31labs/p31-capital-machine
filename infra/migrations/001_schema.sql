-- P31 Capital Machine - Core Database Schema

-- ============================================================
-- 1. DEFi YIELD VAULT
-- ============================================================
CREATE TABLE IF NOT EXISTS vault_deposits (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  user_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  shares TEXT NOT NULL,
  strategy_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  protocol TEXT NOT NULL,
  target TEXT NOT NULL,
  weight INTEGER NOT NULL,
  apy_bps INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT 1,
  last_rebalance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_rebalances (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  gas_cost TEXT,
  old_weights TEXT NOT NULL,
  new_weights TEXT NOT NULL,
  weighted_apy_bps INTEGER NOT NULL,
  tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS vault_yield_harvests (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tx_hash TEXT
);

-- ============================================================
-- 2. MEV ARBITRAGE
-- ============================================================
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  path TEXT NOT NULL,
  dex_path TEXT NOT NULL,
  profit_bps INTEGER NOT NULL,
  expected_profit TEXT NOT NULL,
  gas_cost TEXT NOT NULL,
  net_profit TEXT NOT NULL,
  executed BOOLEAN DEFAULT 0,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  executed_at INTEGER
);

CREATE TABLE IF NOT EXISTS arbitrage_executions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  bundle_hash TEXT,
  status TEXT NOT NULL,
  profit_text TEXT,
  gas_used TEXT,
  block_number INTEGER,
  error TEXT,
  executed_at INTEGER NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES arbitrage_opportunities(id)
);

CREATE TABLE IF NOT EXISTS arbitrage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  total_profit TEXT NOT NULL DEFAULT '0',
  total_attempts INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  total_gas_spent TEXT NOT NULL DEFAULT '0',
  updated_at INTEGER NOT NULL
);

-- ============================================================
-- 3. AI FUNDRAISING AGENT
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  goal INTEGER NOT NULL,
  raised INTEGER DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft',
  milestones TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  owner_address TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  campaign_url TEXT NOT NULL,
  goal INTEGER NOT NULL,
  raised INTEGER NOT NULL,
  category TEXT NOT NULL,
  industry TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  contacted BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  campaign_id TEXT,
  channel TEXT NOT NULL DEFAULT 'email',
  message TEXT NOT NULL,
  response TEXT,
  sent_at INTEGER NOT NULL,
  responded_at INTEGER,
  status TEXT NOT NULL DEFAULT 'sent',
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE TABLE IF NOT EXISTS outreach_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  channel TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scraping_logs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

-- ============================================================
-- 4. AUTO-COMPOUNDER
-- ============================================================
CREATE TABLE IF NOT EXISTS staking_positions (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  protocol TEXT NOT NULL,
  validator TEXT NOT NULL,
  delegator TEXT NOT NULL,
  amount TEXT NOT NULL,
  rewards TEXT NOT NULL DEFAULT '0',
  apy_bps INTEGER DEFAULT 0,
  last_compound INTEGER NOT NULL,
  compound_interval INTEGER NOT NULL DEFAULT 86400,
  auto_compound BOOLEAN DEFAULT 1,
  active BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS compound_history (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  reward_amount TEXT NOT NULL,
  gas_cost TEXT NOT NULL,
  new_total TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  compounded_at INTEGER NOT NULL,
  FOREIGN KEY (position_id) REFERENCES staking_positions(id)
);

-- ============================================================
-- 5. CASHBACK COLLECTOR
-- ============================================================
CREATE TABLE IF NOT EXISTS cashback_transactions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  chain TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  token_address TEXT,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  signature TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);

CREATE TABLE IF NOT EXISTS cashback_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  chain TEXT NOT NULL,
  contract_address TEXT,
  api_endpoint TEXT,
  active BOOLEAN DEFAULT 1,
  config TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cashback_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  total_claimed TEXT NOT NULL DEFAULT '0',
  total_transactions INTEGER NOT NULL DEFAULT 0,
  last_claim_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- ============================================================
-- 6. IP LICENSING
-- ============================================================
CREATE TABLE IF NOT EXISTS ip_assets (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  ip_type TEXT NOT NULL DEFAULT 'code',
  license_terms TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_uri TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  licensee_address TEXT NOT NULL,
  terms TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  auto_renew BOOLEAN DEFAULT 0,
  payments TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES ip_assets(id)
);

CREATE TABLE IF NOT EXISTS license_payments (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

-- ============================================================
-- 7. MICRO-SAVINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS savings_accounts (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  user_address TEXT NOT NULL,
  total_saved TEXT NOT NULL DEFAULT '0',
  total_roundups INTEGER NOT NULL DEFAULT 0,
  yield_earned TEXT NOT NULL DEFAULT '0',
  vault_address TEXT,
  active BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS savings_roundups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  original_tx_hash TEXT,
  original_amount TEXT NOT NULL,
  rounded_amount TEXT NOT NULL,
  roundup_amount TEXT NOT NULL,
  deposited BOOLEAN DEFAULT 0,
  deposit_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES savings_accounts(id)
);

CREATE TABLE IF NOT EXISTS savings_deposits (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  target_vault TEXT,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES savings_accounts(id)
);

-- ============================================================
-- 8. AFFILIATE FLEET
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  referral_link TEXT NOT NULL,
  commission_bps INTEGER NOT NULL,
  cookie_days INTEGER DEFAULT 30,
  active BOOLEAN DEFAULT 1,
  config TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  converted BOOLEAN DEFAULT 0,
  commission TEXT,
  clicked_at INTEGER NOT NULL,
  FOREIGN KEY (program_id) REFERENCES affiliate_programs(id)
);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id TEXT PRIMARY KEY,
  click_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at INTEGER,
  tx_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (click_id) REFERENCES affiliate_clicks(id),
  FOREIGN KEY (program_id) REFERENCES affiliate_programs(id)
);

CREATE TABLE IF NOT EXISTS affiliate_bots (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT,
  strategy TEXT NOT NULL,
  posts_per_day INTEGER DEFAULT 10,
  active BOOLEAN DEFAULT 1,
  config TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (program_id) REFERENCES affiliate_programs(id)
);

-- ============================================================
-- 9. AIRDROP HARVESTER
-- ============================================================
CREATE TABLE IF NOT EXISTS airdrop_protocols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chain TEXT NOT NULL,
  contract_address TEXT,
  claim_url TEXT,
  eligibility_criteria TEXT,
  active BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airdrop_claims (
  id TEXT PRIMARY KEY,
  protocol_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount TEXT,
  token TEXT,
  claim_window_start INTEGER,
  claim_window_end INTEGER,
  eligibility_status TEXT DEFAULT 'unknown',
  claimed BOOLEAN DEFAULT 0,
  claim_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  FOREIGN KEY (protocol_id) REFERENCES airdrop_protocols(id)
);

CREATE TABLE IF NOT EXISTS airdrop_sales (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  amount_sold TEXT NOT NULL,
  proceeds_token TEXT NOT NULL DEFAULT 'USDC',
  proceeds_amount TEXT NOT NULL,
  dex TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  sold_at INTEGER NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES airdrop_claims(id)
);

-- ============================================================
-- 10. DATA MONETIZATION
-- ============================================================
CREATE TABLE IF NOT EXISTS data_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  rate_limit INTEGER NOT NULL DEFAULT 100,
  monthly_quota INTEGER NOT NULL DEFAULT 1000,
  requests_this_month INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS data_queries (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params TEXT,
  response_size INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (api_key_id) REFERENCES data_api_keys(id)
);

CREATE TABLE IF NOT EXISTS data_feeds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  schedule TEXT,
  active BOOLEAN DEFAULT 1,
  config TEXT,
  created_at INTEGER NOT NULL
);

-- ============================================================
-- ORCHESTRATOR
-- ============================================================
CREATE TABLE IF NOT EXISTS orchestrator_state (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestrator_actions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  params TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_vault_deposits_user ON vault_deposits(user_address);
CREATE INDEX IF NOT EXISTS idx_vault_deposits_chain ON vault_deposits(chain);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_chain ON arbitrage_opportunities(chain);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_profit ON arbitrage_opportunities(profit_bps DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_engagements_lead ON engagements(lead_id);
CREATE INDEX IF NOT EXISTS idx_staking_positions_validator ON staking_positions(validator);
CREATE INDEX IF NOT EXISTS idx_cashback_transactions_status ON cashback_transactions(status);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_savings_accounts_user ON savings_accounts(user_address);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_program ON affiliate_clicks(program_id);
CREATE INDEX IF NOT EXISTS idx_airdrop_claims_wallet ON airdrop_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_data_queries_api_key ON data_queries(api_key_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_state_module ON orchestrator_state(module);
