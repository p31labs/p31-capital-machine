import type { Entitlement } from './types';

export class EntitlementClient {
  constructor(private baseUrl: string, private apiToken?: string) {}

  async getEntitlement(did: string): Promise<Entitlement> {
    const headers: Record<string, string> = {};
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/entitlement/${encodeURIComponent(did)}`, { headers });
    if (!res.ok) throw new Error(`Entitlement fetch failed: ${res.status}`);
    return res.json();
  }

  async check(did: string, toolId: string, estimatedCostUsdc: string): Promise<{ ok: boolean; balance?: string; message?: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/entitlement/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ did, tool_id: toolId, estimated_cost_usdc: estimatedCostUsdc }),
    });
    if (!res.ok) throw new Error(`Entitlement check failed: ${res.status}`);
    return res.json();
  }

  async consume(did: string, toolId: string, amountUsdc: string, txHash: string): Promise<{ new_balance: string; usage_meter_id: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/entitlement/consume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ did, tool_id: toolId, amount_usdc: amountUsdc, tx_hash: txHash }),
    });
    if (!res.ok) throw new Error(`Entitlement consume failed: ${res.status}`);
    return res.json();
  }

  async setTier(did: string, tier: 'free' | 'pro' | 'enterprise'): Promise<{ did: string; tier: string; monthly_allowance_usdc: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    const res = await fetch(`${this.baseUrl}/entitlement/tier-set`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ did, tier }),
    });
    if (!res.ok) throw new Error(`Tier set failed: ${res.status}`);
    return res.json();
  }
}
