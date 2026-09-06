const BASE_URLS = {
  revenue: 'https://revenue-ledger.trimtab-signal.workers.dev',
  entitlement: 'https://entitlement.trimtab-signal.workers.dev',
  allocator: 'https://capital-allocator.trimtab-signal.workers.dev',
};

function num(v: any, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || fallback;
  return fallback;
}

export interface RevenueSummary {
  total_usdc: number;
  total_eur: number;
  total_love: number;
  transaction_count: number;
  by_source: Record<string, number>;
  daily: Array<{ date: string; usdc: number; eur: number; love: number; source: string }>;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  source: string;
  amount: string;
  currency: string;
  status: string;
  did?: string;
}

export interface Entitlement {
  did: string;
  tier: 'free' | 'pro' | 'enterprise';
  balance_usdc?: number;
  balance_love?: number;
  usage?: number;
  limit?: number;
}

export interface AllocationStatus {
  target: string;
  allocated: number;
  roi_bps: number;
  status: string;
  last_rebalance: string;
}

export interface ReconciliationEntry {
  source: string;
  payment_balance: number;
  ledger_balance: number;
  settlement_status: string;
  discrepancy?: number;
}

export async function fetchRevenueSummary(range = '30d'): Promise<RevenueSummary> {
  const res = await fetch(`${BASE_URLS.revenue}/revenue/summary?range=${encodeURIComponent(range)}`);
  if (!res.ok) throw new Error(`Revenue summary failed: ${res.status}`);
  const raw = await res.json() as any;
  const by_source: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.source_breakdown || {})) {
    by_source[k] = num((v as any)?.total_usdc ?? v);
  }
  return {
    total_usdc: num(raw.total_usdc),
    total_eur: num(raw.total_eur),
    total_love: num(raw.total_love),
    transaction_count: raw.count || raw.transaction_count || 0,
    by_source,
    daily: raw.daily || [],
  };
}

export async function fetchBalance(did: string): Promise<{ balance: string; currency: string }> {
  const res = await fetch(`${BASE_URLS.revenue}/revenue/balance/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchLedgerEntries(limit = 100, offset = 0): Promise<LedgerEntry[]> {
  const res = await fetch(`${BASE_URLS.revenue}/revenue/ledger?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`Ledger fetch failed: ${res.status}`);
  const raw = await res.json() as any;
  const entries = (raw.entries || raw || []).map((e: any) => ({
    id: e.id,
    timestamp: e.created_at ? new Date(e.created_at).toISOString() : e.timestamp || '',
    source: e.source || '',
    amount: String(e.amount_usdc || e.amount || '0'),
    currency: e.asset || e.currency || 'USDC',
    status: 'settled',
    did: e.payer_did || e.did,
  }));
  return entries;
}

export async function fetchEntitlement(did: string): Promise<Entitlement> {
  const res = await fetch(`${BASE_URLS.entitlement}/entitlement/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Entitlement fetch failed: ${res.status}`);
  const raw = await res.json() as any;
  const data = raw.data || raw;
  return {
    did,
    tier: data.tier || 'free',
    balance_usdc: num(data.balance_usdc),
    balance_love: num(data.balance_love),
    usage: num(data.usage?.total_usdc ?? data.monthly_used_usdc),
    limit: num(data.monthly_allowance_usdc),
  };
}

export async function fetchAllocationStatus(target?: string): Promise<AllocationStatus[]> {
  const url = target
    ? `${BASE_URLS.allocator}/allocation/status?target=${encodeURIComponent(target)}`
    : `${BASE_URLS.allocator}/allocation/statuses`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const raw = await res.json() as any;
  const items = (raw.allocations || raw || []).map((a: any) => ({
    target: a.target || '',
    allocated: num(a.amount_usdc || a.allocated),
    roi_bps: a.roi_bps || 0,
    status: a.status || 'active',
    last_rebalance: a.next_rebalance_at
      ? new Date(a.next_rebalance_at).toISOString()
      : a.last_rebalance || '',
  }));
  return Array.isArray(items) ? items : [];
}

export async function fetchRoi(range = '30d'): Promise<Array<{ target: string; roi_bps: number; period: string }>> {
  const res = await fetch(`${BASE_URLS.allocator}/allocation/roi?range=${encodeURIComponent(range)}`);
  if (!res.ok) return [];
  const raw = await res.json() as any;
  const items = Array.isArray(raw) ? raw : (raw.allocations || []);
  return items.map((r: any) => ({
    target: r.target || '',
    roi_bps: r.roi_bps || r.avg_roi_bps || 0,
    period: r.period || range,
  }));
}

export async function fetchReconciliation(): Promise<ReconciliationEntry[]> {
  const res = await fetch(`${BASE_URLS.revenue}/reconciliation`);
  if (!res.ok) return [];
  const raw = await res.json() as any;
  const items = (raw.entries || raw || []).map((r: any) => ({
    source: r.source || '',
    payment_balance: num(r.payment_balance),
    ledger_balance: num(r.ledger_balance),
    settlement_status: r.settlement_status || 'pending',
    discrepancy: num(r.discrepancy),
  }));
  return Array.isArray(items) ? items : [];
}
