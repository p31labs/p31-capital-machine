export interface Env {
  ALLOCATOR_DB: D1Database;
  REVENUE_LEDGER_URL: string;
  ENVIRONMENT: string;
}

export interface Allocation {
  id: string;
  amount: string;
  target: 'yield' | 'mev' | 'fundraising' | 'compounder' | 'cashback' | 'ip' | 'airdrop' | 'predict';
  status: 'pending' | 'executing' | 'completed' | 'failed';
  created_at: number;
}

export interface AllocationResult {
  allocationId: string;
  status: 'success' | 'partial' | 'failed';
  roi_bps: number;
  tx_hash: string;
  completed_at: number;
  error?: string;
}

export interface AllocateRequest {
  source_tx_id: string;
  amount_usdc: string;
  targets: Array<{ target: string; weight: number }>;
}

export interface RebalanceResult {
  rebalance_id: string;
  moves: Array<{ from: string; to: string; amount: string; reason: string }>;
}
