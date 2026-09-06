export interface RevenueEvent {
  id: string;
  source: 'x402' | 'taler' | 'gumroad' | 'btcpay' | 'love';
  payer_did: string;
  merchant_did: string;
  amount_usdc: string;
  asset: 'USDC' | 'EUR' | 'LOVE';
  metadata?: Record<string, any>;
  settlement_tx?: string;
  created_at: number;
  hash: string;
  prev_hash: string;
}

export interface RevenueSummary {
  total_usdc: string;
  total_eur: string;
  total_love: string;
  count: number;
  avg_per_transaction: string;
  source_breakdown: Record<string, { count: number; total_usdc: string }>;
}

export interface BalanceResult {
  did: string;
  total_earned_usdc: string;
  total_earned_eur: string;
  total_earned_love: string;
  transaction_count: number;
}

export interface Entitlement {
  did: string;
  balance_usdc: string;
  balance_love: string;
  tier: 'free' | 'pro' | 'enterprise';
  monthly_allowance_usdc: string;
  monthly_used_usdc: string;
  last_updated: number;
}

export interface Allocation {
  id: string;
  amount: string;
  target: 'yield' | 'mev' | 'fundraising' | 'compounder' | 'cashback' | 'ip' | 'airdrop' | 'predict';
  status: 'pending' | 'executing' | 'completed' | 'failed';
  created_at: number;
}

export interface RebalanceResult {
  rebalance_id: string;
  moves: Array<{
    from: string;
    to: string;
    amount: string;
    reason: string;
  }>;
}
