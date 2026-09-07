import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Row {
  id: string;
  source: string;
  payer_did: string;
  merchant_did: string;
  amount_usdc: string;
  asset: string;
  metadata: string | null;
  settlement_tx: string | null;
  created_at: number;
  prev_hash: string;
  hash: string;
}

let store: Row[] = [];
let prevClaims = new Map<string, string>();

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
    if (/SELECT hash FROM revenue_events ORDER BY rowid DESC LIMIT 1/i.test(this.sql)) {
      const last = store[store.length - 1];
      return last ? { hash: last.hash } : undefined;
    }
    return undefined;
  }

  async all() {
    if (/SELECT id, hash, prev_hash FROM revenue_events/i.test(this.sql)) {
      return { results: store.map(r => ({ id: r.id, hash: r.hash, prev_hash: r.prev_hash })) };
    }
    return { results: [] };
  }

  async run() {
    if (/INSERT INTO revenue_events/i.test(this.sql)) {
      const b = this.bindArgs;
      const row: Row = {
        id: b[0],
        source: b[1],
        payer_did: b[2],
        merchant_did: b[3],
        amount_usdc: b[4],
        asset: b[5],
        metadata: b[6],
        settlement_tx: b[7],
        created_at: b[8],
        prev_hash: b[9],
        hash: b[10],
      };
      // Enforce UNIQUE(prev_hash) exactly like the real D1 index.
      if (prevClaims.has(row.prev_hash)) {
        const err: any = new Error('UNIQUE constraint failed: revenue_events.prev_hash');
        err.code = 7500;
        throw err;
      }
      store.push(row);
      prevClaims.set(row.prev_hash, row.hash);
      return { success: true, meta: { changes: 1 } } as any;
    }
    return { success: true } as any;
  }

  async doRun() {
    return this.run();
  }
}

const mockDB = {
  prepare: vi.fn((sql: string) => new MockD1Statement(sql)),
  exec: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn(async (statements: MockD1Statement[]) => {
    const results: any[] = [];
    for (const stmt of statements) {
      results.push(await stmt.doRun());
    }
    return results;
  }),
};

import { RevenueLedger } from './ledger';

describe('RevenueLedger', () => {
  let ledger: RevenueLedger;

  beforeEach(() => {
    vi.clearAllMocks();
    store = [];
    prevClaims = new Map();
    ledger = new RevenueLedger(mockDB as any, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      timed: vi.fn((_msg: string, fn: () => Promise<any>) => fn()),
      sanitize: vi.fn((d: any) => d),
    } as any);
  });

  it('should record revenue with SHA-256 hash chain', async () => {
    const result = await ledger.recordRevenue({
      source: 'x402',
      payer_did: 'did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN',
      merchant_did: 'did:key:z6MkhaXgBZDvotDkL5257fJdEbdbbnaB5L1nnENRKjHiWtkN',
      amount_usdc: '10.50',
      asset: 'USDC',
      metadata: { tool: 'oasis_execute' },
    });

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('created_at');
    expect(typeof result.hash).toBe('string');
    expect(result.hash).toHaveLength(64);
  });

  it('should generate different hashes for different events', async () => {
    const result1 = await ledger.recordRevenue({
      source: 'x402',
      payer_did: 'did:key:test1',
      merchant_did: 'did:key:test2',
      amount_usdc: '10.00',
      asset: 'USDC',
    });

    const result2 = await ledger.recordRevenue({
      source: 'x402',
      payer_did: 'did:key:test1',
      merchant_did: 'did:key:test2',
      amount_usdc: '20.00',
      asset: 'USDC',
    });

    expect(result1.hash).not.toBe(result2.hash);
  });

  it('should return revenue summary with breakdown', async () => {
    const summary = await ledger.getRevenueSummary(null, '30d');
    expect(summary).toHaveProperty('total_usdc');
    expect(summary).toHaveProperty('total_eur');
    expect(summary).toHaveProperty('total_love');
    expect(summary).toHaveProperty('count');
    expect(summary).toHaveProperty('source_breakdown');
  });

  it('should return balance for a DID', async () => {
    const balance = await ledger.getBalance('did:key:test1');
    expect(balance).toHaveProperty('did', 'did:key:test1');
    expect(balance).toHaveProperty('total_earned_usdc');
    expect(balance).toHaveProperty('transaction_count');
  });

  it('should return zero balance for DID with no transactions', async () => {
    const unknownResult = await ledger.getBalance('did:key:unknown');
    expect(unknownResult).toEqual({
      did: 'did:key:unknown',
      total_earned_usdc: '0',
      total_earned_eur: '0',
      total_earned_love: '0',
      transaction_count: 0,
    });
  });

  it('should return paginated ledger entries', async () => {
    const ledgerData = await ledger.getLedgerEntries(10, 0, null);
    expect(ledgerData).toHaveProperty('entries');
    expect(ledgerData).toHaveProperty('total');
    expect(Array.isArray(ledgerData.entries)).toBe(true);
  });

  it('should verify hash chain integrity on empty ledger', async () => {
    const verification = await ledger.verifyHashChain();
    expect(verification.valid).toBe(true);
    expect(verification.total_entries).toBe(0);
  });

  it('should record revenue from different sources', async () => {
    const sources: Array<'x402' | 'taler' | 'gumroad' | 'btcpay' | 'love'> = ['x402', 'taler', 'gumroad', 'btcpay', 'love'];

    for (const source of sources) {
      const result = await ledger.recordRevenue({
        source,
        payer_did: `did:key:${source}`,
        merchant_did: 'did:key:merchant',
        amount_usdc: source === 'taler' ? '5.00' : '1.00',
        asset: source === 'taler' ? 'EUR' : source === 'love' ? 'LOVE' : 'USDC',
      });
      expect(result.hash).toBeDefined();
      expect(result.hash).toHaveLength(64);
    }
  });

  it('should chain hashes correctly across multiple events', async () => {
    const events = [
      { source: 'x402' as const, amount: '10.00', asset: 'USDC' as const },
      { source: 'taler' as const, amount: '5.00', asset: 'EUR' as const },
      { source: 'love' as const, amount: '100.00', asset: 'LOVE' as const },
    ];

    const hashes: string[] = [];
    for (const event of events) {
      const result = await ledger.recordRevenue({
        source: event.source,
        payer_did: 'did:key:sequential',
        merchant_did: 'did:key:merchant',
        amount_usdc: event.amount,
        asset: event.asset,
      });
      hashes.push(result.hash);
    }

    expect(hashes[0]).not.toBe(hashes[1]);
    expect(hashes[1]).not.toBe(hashes[2]);
    expect(hashes[0]).not.toBe(hashes[2]);

    const verification = await ledger.verifyHashChain();
    expect(verification.valid).toBe(true);
    expect(verification.total_entries).toBe(3);
  });

  it('should retry and still chain when two writers claim the same head', async () => {
    // Simulate two concurrent appends reading the same genesis head: the
    // second must hit UNIQUE(prev_hash) and retry; both must still attach to
    // the chain.
    const results = await Promise.all([
      ledger.recordRevenue({ source: 'x402', payer_did: 'did:key:a', merchant_did: 'did:key:m', amount_usdc: '1.00', asset: 'USDC' }),
      ledger.recordRevenue({ source: 'x402', payer_did: 'did:key:b', merchant_did: 'did:key:m', amount_usdc: '1.00', asset: 'USDC' }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].hash).not.toBe(results[1].hash);

    const verification = await ledger.verifyHashChain();
    expect(verification.valid).toBe(true);
    expect(verification.total_entries).toBe(2);
  });
});