import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevenueLedgerClient } from './revenue-ledger';

describe('RevenueLedgerClient', () => {
  let client: RevenueLedgerClient;

  beforeEach(() => {
    client = new RevenueLedgerClient('https://revenue-ledger.trimtab-signal.workers.dev');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'test', hash: 'abc123', created_at: 1234567890 }),
    });
  });

  it('should record revenue', async () => {
    const result = await client.recordRevenue({
      source: 'x402',
      payer_did: 'did:key:test',
      merchant_did: 'did:key:merchant',
      amount_usdc: '10.00',
      asset: 'USDC',
    });
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('hash');
  });

  it('should get balance', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ did: 'did:key:test', total_earned_usdc: '10.00', total_earned_eur: '0', total_earned_love: '0', transaction_count: 1 }),
    });
    const balance = await client.getBalance('did:key:test');
    expect(balance.total_earned_usdc).toBe('10.00');
  });
});
