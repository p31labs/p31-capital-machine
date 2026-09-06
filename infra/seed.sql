-- P31 Capital Machine - Seed Data
-- Default configs, templates, and sources

-- Affiliate programs
INSERT OR IGNORE INTO affiliate_programs (id, name, platform, referral_link, commission_bps, cookie_days, active, config, created_at)
VALUES
  ('coinbase', 'Coinbase', 'cex', 'https://coinbase.com/join/referral', 3000, 30, 1, '{"type":"signup_bonus"}', unixepoch()),
  ('binance', 'Binance', 'cex', 'https://binance.com/referral', 2000, 30, 1, '{"type":"fee_discount"}', unixepoch()),
  ('ledger', 'Ledger', 'hardware', 'https://shop.ledger.com/referral', 5000, 90, 1, '{"type":"discount"}', unixepoch()),
  ('trezor', 'Trezor', 'hardware', 'https://trezor.io/referral', 4000, 90, 1, '{"type":"discount"}', unixepoch()),
  ('coinrebate', 'CoinRebate', 'rebate', 'https://coinrebate.com/ref', 2000, 30, 1, '{"type":"fee_rebate"}', unixepoch());

-- Cashback sources
INSERT OR IGNORE INTO cashback_sources (id, name, type, chain, contract_address, api_endpoint, active, config, created_at)
VALUES
  ('pumpfun', 'Pump.fun Cashback', 'dex', 'solana', NULL, 'https://api.pump.fun/cashback', 1, '{"fee_percentage":0.5}', unixepoch()),
  ('jupiter', 'Jupiter Cashback', 'aggregator', 'solana', NULL, 'https://api.jupiter.com/cashback', 1, '{"fee_percentage":0.3}', unixepoch()),
  ('1inch', '1inch Cashback', 'aggregator', 'ethereum', NULL, 'https://api.1inch.io/cashback', 1, '{"fee_percentage":0.1}', unixepoch()),
  ('odos', 'Odos Cashback', 'aggregator', 'ethereum', NULL, 'https://api.odos.xyz/cashback', 1, '{"fee_percentage":0.15}', unixepoch());

-- Airdrop protocols to monitor
INSERT OR IGNORE INTO airdrop_protocols (id, name, chain, contract_address, claim_url, active, created_at)
VALUES
  ('layerzero', 'LayerZero', 'ethereum', NULL, 'https://layerzero.foundation/claim', 1, unixepoch()),
  ('zksync', 'zkSync', 'ethereum', NULL, 'https://claim.zksync.io', 1, unixepoch()),
  ('scroll', 'Scroll', 'ethereum', NULL, 'https://scroll.io/claim', 1, unixepoch()),
  ('blur', 'Blur', 'ethereum', NULL, 'https://blur.io/claim', 1, unixepoch()),
  ('jito', 'Jito', 'solana', NULL, 'https://jito.foundation/claim', 1, unixepoch()),
  ('wormhole', 'Wormhole', 'multi', NULL, 'https://wormhole.com/claim', 1, unixepoch());

-- Outreach templates
INSERT OR IGNORE INTO outreach_templates (id, name, subject, body, channel, variables, created_at)
VALUES
  ('cold_email_1', 'Cold Email - Fundraising Help', 'Quick question about your campaign',
   'Hi {{name}},\n\nI noticed your {{platform}} campaign "{{campaign_title}}" is at {{percentage}}% of its ${{goal}} goal.\n\nWe help projects like yours with automated fundraising solutions — AI-powered outreach, multi-chain yield optimization, and smart contract fundraising tools. No upfront costs; we take a small success fee.\n\nWould you be open to a quick chat?\n\nBest,\nP31 Labs',
   'email', '["name","platform","campaign_title","percentage","goal"]', unixepoch()),
  ('cold_email_2', 'Cold Email - Yield Optimization', 'Maximize your fundraising proceeds',
   'Hi {{name}},\n\nRunning a successful campaign is just the start. We help organizations deploy raised funds into DeFi yield vaults to generate ongoing returns — turning one-time donations into sustainable revenue.\n\nYour campaign has raised ${{raised}} so far. Even at 5% APY, that could generate ${{yearly_yield}}/year in passive income.\n\nWant to learn more?\n\nBest,\nP31 Labs',
   'email', '["name","raised","yearly_yield"]', unixepoch()),
  ('discord_intro', 'Discord - Initial Outreach', NULL,
   'Hey {{name}}! 👋 I saw your project {{project_name}} and love what you''re building. We run an automated fundraising platform that helps projects like yours raise capital more efficiently. Want to hear more?',
   'discord', '["name","project_name"]', unixepoch()),
  ('twitter_dm', 'Twitter DM - Partnership', NULL,
   'Hi {{name}}, love your work on {{project_name}}. We''re building automated fundraising infrastructure for Web3 projects — think yield-optimized donation vaults + AI-powered grant sourcing. Open to a chat?',
   'twitter', '["name","project_name"]', unixepoch());

-- Cashback KV state (placeholder)
INSERT OR IGNORE INTO cashback_stats (id, token, total_claimed, total_transactions, last_claim_at, updated_at)
VALUES
  (1, 'USDC', '0', 0, NULL, unixepoch()),
  (2, 'SOL', '0', 0, NULL, unixepoch()),
  (3, 'ETH', '0', 0, NULL, unixepoch());

-- Arbitrage stats (placeholder per chain)
INSERT OR IGNORE INTO arbitrage_stats (id, chain, total_profit, total_attempts, success_count, total_gas_spent, updated_at)
VALUES
  (1, 'ethereum', '0', 0, 0, '0', unixepoch()),
  (2, 'base', '0', 0, 0, '0', unixepoch()),
  (3, 'solana', '0', 0, 0, '0', unixepoch());
