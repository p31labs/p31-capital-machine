import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockD1Statement {
  private results: any = { count: 0, total: 0 };
  private allResults: any = { results: [] };

  bind(..._args: any[]) {
    return this;
  }

  async first() { return this.results; }
  async all() { return this.allResults; }
  async run() { return { success: true }; }
}

const mockDB = {
  prepare: vi.fn((_sql: string) => new MockD1Statement()),
  exec: vi.fn().mockResolvedValue(undefined),
};

import { AuditTrail } from './audit';

describe('AuditTrail', () => {
  let audit: AuditTrail;

  beforeEach(() => {
    vi.clearAllMocks();
    audit = new AuditTrail(mockDB as any);
  });

  it('logEvent is a thin wrapper over record', async () => {
    // MockD1Statement returns empty chain head -> previousHash 'genesis'
    vi.spyOn(audit, 'record').mockResolvedValue('abc123hash');
    const hash = await audit.logEvent('revenue_recorded', { id: 'rid-1', source: 'x402' });
    expect(hash).toBe('abc123hash');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'revenue_recorded',
        actor_did: 'system',
        action: 'revenue_recorded',
        target: 'rid-1',
      })
    );
  });

  it('getEvents proxies into query with filters', async () => {
    vi.spyOn(audit, 'query').mockResolvedValue([{ id: 'e1' }]);
    const events = await audit.getEvents('sale', 'did:key:abc', '1234567890', 25);
    expect(audit.query).toHaveBeenCalledWith({
      event_type: 'sale',
      actor_did: 'did:key:abc',
      since: 1234567890,
      limit: 25,
    });
    expect(events).toEqual([{ id: 'e1' }]);
  });

  it('verifyIntegrity proxies into verifyChain', async () => {
    vi.spyOn(audit, 'verifyChain').mockResolvedValue({ valid: true });
    const result = await audit.verifyIntegrity();
    expect(result).toEqual({ valid: true });
    expect(audit.verifyChain).toHaveBeenCalledOnce();
  });
});