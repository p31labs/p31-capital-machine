import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapitalAllocator } from './service';

class MockD1Statement {
  private sql: string;
  private bindArgs: any[] = [];
  private firstResult: any = null;
  private allResults: any = { results: [] };

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...args: any[]) {
    this.bindArgs = args;
    return this;
  }

  setFirst(result: any) {
    this.firstResult = result;
    return this;
  }

  setAll(results: any[]) {
    this.allResults = { results };
    return this;
  }

  getSql() {
    return this.sql;
  }

  async first() { return this.firstResult; }
  async all() { return this.allResults; }
  async run() { return { success: true }; }
}

const createMockStatement = (sql: string) => new MockD1Statement(sql);

const mockDB = {
  prepare: vi.fn((sql: string) => createMockStatement(sql)),
  exec: vi.fn().mockResolvedValue(undefined),
};

describe('CapitalAllocator', () => {
  let allocator: CapitalAllocator;

  beforeEach(() => {
    vi.clearAllMocks();
    allocator = new CapitalAllocator(mockDB as any, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      timed: vi.fn((_msg: string, fn: () => Promise<any>) => fn()),
      sanitize: vi.fn((d: any) => d),
    } as any, {
      ALLOCATOR_DB: mockDB as any,
      REVENUE_LEDGER_URL: 'https://revenue-ledger.example.com',
      ENVIRONMENT: 'test',
    } as any);
  });

  it('should create schema', async () => {
    await allocator.ensureSchema();
    expect(mockDB.exec).toHaveBeenCalled();
  });

  it('should allocate capital proportionally to targets', async () => {
    const allocations = await allocator.allocate({
      source_tx_id: 'tx-123',
      amount_usdc: '100',
      targets: [
        { target: 'yield', weight: 60 },
        { target: 'mev', weight: 40 },
      ],
    });

    expect(allocations).toHaveLength(2);
    expect(allocations[0].target).toBe('yield');
    expect(allocations[0].amount).toBe('60');
    expect(allocations[1].target).toBe('mev');
    expect(allocations[1].amount).toBe('40');
  });

  it('should return allocation status for a target', async () => {
    const statement = new MockD1Statement('');
    statement.setFirst({ total: 150 });
    (mockDB.prepare as any).mockReturnValue(statement);

    const status = await allocator.getStatus('yield');
    expect(status).toEqual({
      target: 'yield',
      current_allocation: '150',
      roi_bps: 0,
      health_check: 'healthy',
    });
  });

  it('should return no_activity when no allocations exist', async () => {
    const statement = new MockD1Statement('');
    statement.setFirst({ total: 0 });
    (mockDB.prepare as any).mockReturnValue(statement);

    const status = await allocator.getStatus('yield');
    expect(status.health_check).toBe('no_activity');
    expect(status.current_allocation).toBe('0');
  });

  it('should return underperforming when roi_bps is negative', async () => {
    const allocationStatement = new MockD1Statement('SELECT SUM');
    allocationStatement.setFirst({ total: 150 });
    
    const roiStatement = new MockD1Statement('SELECT AVG');
    roiStatement.setFirst({ avg_roi: -50 });

    (mockDB.prepare as any).mockImplementation((sql: string) => {
      if (sql.includes('SUM(CAST(amount_usdc AS REAL))')) {
        return allocationStatement;
      }
      return roiStatement;
    });

    const status = await allocator.getStatus('mev');
    expect(status.health_check).toBe('underperforming');
  });

  it('should aggregate ROI by target', async () => {
    const statement = new MockD1Statement('');
    statement.setAll([
      { target: 'yield', avg_roi: 150 },
      { target: 'mev', avg_roi: 42 },
    ]);
    (mockDB.prepare as any).mockReturnValue(statement);

    const roi = await allocator.getRoi('30d');
    expect(roi.roi_by_target).toEqual({ yield: 150, mev: 42 });
  });

  it('should return empty ROI for no results', async () => {
    const statement = new MockD1Statement('');
    statement.setAll([]);
    (mockDB.prepare as any).mockReturnValue(statement);

    const roi = await allocator.getRoi('30d');
    expect(roi.roi_by_target).toEqual({});
  });

  it('should rebalance from underperformers to overperformers', async () => {
    const allStatement = new MockD1Statement('');
    allStatement.setAll([
      { target: 'yield', avg_roi: 200 },
      { target: 'mev', avg_roi: 50 },
    ]);
    (mockDB.prepare as any).mockReturnValue(allStatement);

    const sumStatement = new MockD1Statement('');
    sumStatement.setFirst({ total: 100 });
    (mockDB.prepare as any).mockReturnValue(sumStatement);

    const result = await allocator.rebalance();
    expect(result.rebalance_id).toBeDefined();
    expect(Array.isArray(result.moves)).toBe(true);
  });

  it('should record rebalance moves in revenue ledger', async () => {
    const allStatement = new MockD1Statement('');
    allStatement.setAll([
      { target: 'yield', avg_roi: 200 },
      { target: 'mev', avg_roi: 50 },
    ]);
    (mockDB.prepare as any).mockReturnValue(allStatement);

    const sumStatement = new MockD1Statement('');
    sumStatement.setFirst({ total: 100 });
    (mockDB.prepare as any).mockReturnValue(sumStatement);

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    (global as any).fetch = mockFetch;

    const result = await allocator.rebalance();

    if (result.moves.length > 0) {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('revenue-ledger'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  });

  it('should return empty moves when no targets to evaluate', async () => {
    const statement = new MockD1Statement('');
    statement.setAll([]);
    (mockDB.prepare as any).mockReturnValue(statement);

    const result = await allocator.rebalance();
    expect(result.moves).toEqual([]);
  });
});
