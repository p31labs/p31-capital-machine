import type { RevenueEvent, RevenueSummary, BalanceResult } from './types';

export class RevenueLedgerClient {
  constructor(private baseUrl: string, private apiToken?: string) {}

  async recordRevenue(event: {
    source: 'x402' | 'taler' | 'gumroad' | 'btcpay' | 'love' | 'arcade';
    payer_did: string;
    merchant_did: string;
    amount_usdc: string;
    asset: 'USDC' | 'EUR' | 'LOVE';
    amount_love?: string;
    tx_hash?: string;
    metadata?: Record<string, any>;
    settlement_tx?: string;
  }): Promise<{ id: string; hash: string; created_at: number }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;

    const res = await fetch(`${this.baseUrl}/revenue/record`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`Revenue record failed: ${res.status}`);
    return res.json();
  }

  async getSummary(source?: string, range: string = '30d'): Promise<RevenueSummary> {
    const url = new URL(`${this.baseUrl}/revenue/summary`);
    if (source) url.searchParams.set('source', source);
    url.searchParams.set('range', range);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Revenue summary failed: ${res.status}`);
    return res.json();
  }

  async getBalance(did: string): Promise<BalanceResult> {
    const res = await fetch(`${this.baseUrl}/revenue/balance/${encodeURIComponent(did)}`);
    if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
    return res.json();
  }

  async getLedger(limit = 100, offset = 0, source?: string): Promise<{ entries: RevenueEvent[]; total: number }> {
    const url = new URL(`${this.baseUrl}/revenue/ledger`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (source) url.searchParams.set('source', source);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Ledger fetch failed: ${res.status}`);
    return res.json();
  }

  async verifyChain(): Promise<{ valid: boolean; total_entries: number; last_hash?: string }> {
    const res = await fetch(`${this.baseUrl}/revenue/verify-chain`);
    if (!res.ok) throw new Error(`Chain verify failed: ${res.status}`);
    return res.json();
  }
}
