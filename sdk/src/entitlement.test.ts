import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementClient } from './entitlement';

describe('EntitlementClient', () => {
  let client: EntitlementClient;

  beforeEach(() => {
    client = new EntitlementClient('https://entitlement.trimtab-signal.workers.dev');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ did: 'test', balance_usdc: '100', balance_love: '0', tier: 'free', monthly_allowance_usdc: '0', monthly_used_usdc: '0', last_updated: 1234567890 }),
    });
  });

  it('should get entitlement', async () => {
    const entitlement = await client.getEntitlement('did:key:test');
    expect(entitlement.tier).toBe('free');
  });

  it('should check entitlement', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, balance: '100' }),
    });
    const result = await client.check('did:key:test', 'oasis_execute', '0.05');
    expect(result.ok).toBe(true);
  });
});
