import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevenueLedger } from '../../workers/revenue-ledger/ledger';
import type { RecordRevenueRequest, BalanceResult } from '../../workers/revenue-ledger/index';

// --- Stateful Mock D1 Database ---
class MockD1Database {
  private events: any[] = [];
  private idCounter = 1;

  prepare(sql: string) {
    const self = this;
    const statement: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        statement.bindArgs = args;
        return statement;
      },
      async first() {
        return statement.computeFirst();
      },
      async all() {
        return statement.computeAll();
      },
      async run() {
        if (sql.includes('INSERT INTO revenue_events')) {
          const event = {
            id: statement.bindArgs[0],
            source: statement.bindArgs[1],
            payer_did: statement.bindArgs[2],
            merchant_did: statement.bindArgs[3],
            amount_usdc: statement.bindArgs[4],
            asset: statement.bindArgs[5],
            metadata: statement.bindArgs[6],
            settlement_tx: statement.bindArgs[7],
            created_at: statement.bindArgs[8],
            prev_hash: statement.bindArgs[9],
            hash: statement.bindArgs[10],
          };
          self.events.push(event);
        }
        return { success: true };
      },
      computeFirst() {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.includes('SELECT hash FROM revenue_events ORDER BY created_at DESC')) {
          const sorted = [...self.events].sort((a, b) => b.created_at - a.created_at);
          return sorted.length > 0 ? { hash: sorted[0].hash } : undefined;
        }
        if (normalized.includes('SELECT COUNT(*) as total FROM revenue_events')) {
          return { total: self.events.length };
        }
        return undefined;
      },
      computeAll() {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.includes('SELECT asset, SUM(CAST(amount_usdc AS REAL))')) {
          const payerDid = statement.bindArgs[0];
          const filtered = self.events.filter((e: any) => e.payer_did === payerDid);
          const grouped: Record<string, { asset: string; total: number; count: number }> = {};
          for (const e of filtered) {
            if (!grouped[e.asset]) grouped[e.asset] = { asset: e.asset, total: 0, count: 0 };
            grouped[e.asset].total += parseFloat(e.amount_usdc);
            grouped[e.asset].count += 1;
          }
          return { results: Object.values(grouped) };
        }
        if (normalized.includes('SELECT id, hash, prev_hash FROM revenue_events')) {
          const sorted = [...self.events].sort((a: any, b: any) => a.created_at - b.created_at);
          return { results: sorted.map((e: any) => ({ id: e.id, hash: e.hash, prev_hash: e.prev_hash })) };
        }
        if (normalized.includes('SELECT * FROM revenue_events')) {
          const limit = statement.bindArgs[statement.bindArgs.length - 2];
          const offset = statement.bindArgs[statement.bindArgs.length - 1];
          const sourceFilter = statement.bindArgs.length === 3 ? statement.bindArgs[0] : null;
          let filtered = [...self.events];
          if (sourceFilter) {
            filtered = filtered.filter((e: any) => e.source === sourceFilter);
          }
          const sorted = filtered.sort((a: any, b: any) => b.created_at - a.created_at);
          const page = sorted.slice(offset, offset + limit);
          return {
            results: page.map((e: any) => ({
              ...e,
              metadata: e.metadata ? JSON.parse(e.metadata) : null,
            })),
          };
        }
        return { results: [] };
      },
    };

    return statement;
  }

  async exec() {
    return undefined;
  }
}

const createMockDB = () => new MockD1Database();

const createLedger = (db: MockD1Database) => {
  return new RevenueLedger(db as any, {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn((_msg: string, fn: () => Promise<any>) => fn()),
    sanitize: vi.fn((d: any) => d),
  } as any);
};

// --- Mock fetch for external services ---
const mockFetch = vi.fn();
global.fetch = mockFetch;

const baseURL = 'https://';

describe('Monetization Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('x402 payment → Revenue Ledger → Entitlement check → Allocation', async () => {
    const db = createMockDB();
    const ledger = createLedger(db);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/entitlement/check')) {
        return Promise.resolve(new Response(JSON.stringify({
          entitled: true,
          remaining: '990.00',
          currency: 'USDC',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/entitlement/consume')) {
        return Promise.resolve(new Response(JSON.stringify({
          consumed: true,
          remaining: '990.00',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/allocation/create')) {
        return Promise.resolve(new Response(JSON.stringify({
          allocation_id: 'alloc_abc123',
          strategy: 'yield-vault',
          amount: '10.00',
          expected_roi: '0.05',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/roi')) {
        return Promise.resolve(new Response(JSON.stringify({
          total_invested: '10.00',
          current_value: '10.50',
          roi: '0.05',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('Not found', { status: 404 }));
    });

    const payment: RecordRevenueRequest = {
      source: 'x402',
      payer_did: 'did:key:payer1',
      merchant_did: 'did:key:merchant1',
      amount_usdc: '10.00',
      asset: 'USDC',
      metadata: { tool: 'oasis_execute', endpoint: '/api/generate' },
    };

    const revenueResult = await ledger.recordRevenue(payment);
    expect(revenueResult).toHaveProperty('id');
    expect(revenueResult).toHaveProperty('hash');
    expect(typeof revenueResult.hash).toBe('string');
    expect(revenueResult.hash).toHaveLength(64);

    const entitlementCheck = await fetch(`${baseURL}entitlement-service/entitlement/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: payment.payer_did, amount: payment.amount_usdc }),
    });
    expect(entitlementCheck.status).toBe(200);
    const entitlementData = await entitlementCheck.json();
    expect(entitlementData.entitled).toBe(true);

    const consumeResult = await fetch(`${baseURL}entitlement-service/entitlement/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: payment.payer_did, amount: payment.amount_usdc }),
    });
    expect(consumeResult.status).toBe(200);
    const consumeData = await consumeResult.json();
    expect(consumeData.consumed).toBe(true);

    const allocationResult = await fetch(`${baseURL}capital-allocator/allocation/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: payment.payer_did, amount: payment.amount_usdc }),
    });
    expect(allocationResult.status).toBe(201);
    const allocationData = await allocationResult.json();
    expect(allocationData).toHaveProperty('allocation_id');

    const roiResult = await fetch(`${baseURL}capital-allocator/roi?allocation_id=${allocationData.allocation_id}`);
    expect(roiResult.status).toBe(200);
    const roiData = await roiResult.json();
    expect(roiData).toHaveProperty('roi');

    const chainVerification = await ledger.verifyHashChain();
    expect(chainVerification.valid).toBe(true);
    expect(chainVerification.total_entries).toBe(1);
  });

  it('Idempotency (repeat same payment = same ledger entry)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/revenue/record')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'idempotent-uuid-123',
          hash: 'idempotent-hash-abc',
          created_at: 1700000000000,
        }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('Not found', { status: 404 }));
    });

    const paymentBody = JSON.stringify({
      source: 'x402',
      payer_did: 'did:key:idempotent',
      merchant_did: 'did:key:merchant',
      amount_usdc: '15.00',
      asset: 'USDC',
      metadata: { idempotency_key: 'key-001' },
    });

    const first = await fetch(`${baseURL}revenue-ledger/revenue/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: paymentBody,
    });
    const firstData = await first.json();

    const second = await fetch(`${baseURL}revenue-ledger/revenue/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: paymentBody,
    });
    const secondData = await second.json();

    expect(firstData.id).toBe(secondData.id);
    expect(firstData.hash).toBe(secondData.hash);
    expect(firstData.created_at).toBe(secondData.created_at);
  });

  it('Cross-rail balance consistency (USDC + EUR + LOVE = total)', async () => {
    const db = createMockDB();
    const ledger = createLedger(db);

    await ledger.recordRevenue({
      source: 'x402',
      payer_did: 'did:key:crossrail',
      merchant_did: 'did:key:merchant',
      amount_usdc: '100.00',
      asset: 'USDC',
    });

    await ledger.recordRevenue({
      source: 'taler',
      payer_did: 'did:key:crossrail',
      merchant_did: 'did:key:merchant',
      amount_usdc: '50.00',
      asset: 'EUR',
    });

    await ledger.recordRevenue({
      source: 'love',
      payer_did: 'did:key:crossrail',
      merchant_did: 'did:key:merchant',
      amount_usdc: '200.00',
      asset: 'LOVE',
    });

    const balance = await ledger.getBalance('did:key:crossrail') as BalanceResult;
    expect(balance.total_earned_usdc).toBe('100');
    expect(balance.total_earned_eur).toBe('50');
    expect(balance.total_earned_love).toBe('200');
    expect(balance.transaction_count).toBe(3);
  });

  it('Entitlement preflight gate (402 when insufficient balance)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/entitlement/check')) {
        return Promise.resolve(new Response(JSON.stringify({
          entitled: false,
          reason: 'Insufficient balance',
          required: '1000.00',
          available: '5.00',
        }), { status: 402, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('Not found', { status: 404 }));
    });

    const response = await fetch(`${baseURL}entitlement-service/entitlement/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: 'did:key:low-balance', amount: '1000.00' }),
    });

    expect(response.status).toBe(402);
    const data = await response.json();
    expect(data.entitled).toBe(false);
    expect(data.reason).toBe('Insufficient balance');
    expect(data.required).toBe('1000.00');
    expect(data.available).toBe('5.00');
  });
});
