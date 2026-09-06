import type { Allocation, RebalanceResult } from './types';

export class CapitalAllocatorClient {
  constructor(private baseUrl: string, private apiToken?: string) {}

  async allocate(request: {
    source_tx_id: string;
    amount_usdc: string;
    targets: Array<{ target: string; weight: number }>;
  }): Promise<{ allocations: Allocation[] }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/allocate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Allocation failed: ${res.status}`);
    return res.json();
  }

  async getStatus(target: string): Promise<{ target: string; current_allocation: string; roi_bps: number; health_check: string }> {
    const url = new URL(`${this.baseUrl}/allocation/status`);
    url.searchParams.set('target', target);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
    return res.json();
  }

  async getRoi(range = '30d'): Promise<Record<string, number>> {
    const url = new URL(`${this.baseUrl}/allocation/roi`);
    url.searchParams.set('range', range);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`ROI fetch failed: ${res.status}`);
    return res.json();
  }

  async rebalance(): Promise<RebalanceResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/rebalance`, { method: 'POST', headers });
    if (!res.ok) throw new Error(`Rebalance failed: ${res.status}`);
    return res.json();
  }
}
