import { describe, it, expect, vi, beforeEach } from 'vitest';

interface AuditEvent {
  id: string;
  timestamp: number;
  event_type: string;
  actor_did: string | null;
  action: string;
  target: string | null;
  metadata: string;
  hash: string;
  previous_hash: string;
}

let store: AuditEvent[] = [];

class MockD1Statement {
  private sql: string;
  private bindArgs: any[];

  constructor(sql: string) {
    this.sql = sql;
    this.bindArgs = [];
  }

  bind(...args: any[]) {
    this.bindArgs = args;
    return this;
  }

  async first() {
    if (/SELECT hash FROM audit_events/i.test(this.sql)) {
      const last = store[store.length - 1];
      return last ? { hash: last.hash } : undefined;
    }
    return undefined;
  }

  async all() {
    if (/SELECT id, hash, previous_hash FROM audit_events/i.test(this.sql)) {
      return { results: store.map(e => ({ id: e.id, hash: e.hash, previous_hash: e.previous_hash })) };
    }
    return { results: [] };
  }

  async run() {
    if (/INSERT INTO audit_events/i.test(this.sql)) {
      const b = this.bindArgs as any[];
      const event: AuditEvent = {
        id: b[0],
        timestamp: b[1],
        event_type: b[2],
        actor_did: b[3],
        action: b[4],
        target: b[5],
        metadata: b[6],
        hash: b[7],
        previous_hash: b[8],
      };
      if (store.some(e => e.previous_hash === event.previous_hash)) {
        const err: any = new Error('UNIQUE constraint failed: audit_events.previous_hash');
        err.code = 7500;
        throw err;
      }
      if (store.some(e => e.hash === event.hash)) {
        const err: any = new Error('UNIQUE constraint failed: audit_events.hash');
        err.code = 7500;
        throw err;
      }
      store.push(event);
      return { success: true } as any;
    }
    return { success: true } as any;
  }
}

const mockDB = {
  prepare: vi.fn((sql: string) => new MockD1Statement(sql)),
  exec: vi.fn().mockResolvedValue(undefined),
};

import { AuditTrail } from './audit';

describe('AuditTrail', () => {
  let audit: AuditTrail;

  beforeEach(() => {
    vi.clearAllMocks();
    store = [];
    audit = new AuditTrail(mockDB as any);
  });

  it('logEvent is a thin wrapper over record', async () => {
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

  it('records sequential events as a valid chain', async () => {
    await audit.record({ event_type: 'a', action: 'a' });
    await audit.record({ event_type: 'b', action: 'b' });
    await audit.record({ event_type: 'c', action: 'c' });
    const result = await audit.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('retries and keeps chain valid under concurrent head contention', async () => {
    const results = await Promise.all([
      audit.record({ event_type: 'x', action: 'x' }),
      audit.record({ event_type: 'y', action: 'y' }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).not.toBe(results[1]);
    const result = await audit.verifyChain();
    expect(result.valid).toBe(true);
  });
});