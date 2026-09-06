import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock D1 with proper chaining
class MockD1Statement {
  private sql: string;
  private bindArgs: any[];
  private results: any = { count: 0, total: 0 };
  private allResults: any = { results: [] };

  constructor(sql: string) { this.sql = sql; this.bindArgs = []; }

  bind(...args: any[]) {
    this.bindArgs = args;
    return this;
  }

  async first() { return this.results; }
  async all() { return this.allResults; }
  async run() { return { success: true }; }
}

const mockDB = {
  prepare: vi.fn((sql: string) => new MockD1Statement(sql)),
};

const mockKV = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ keys: [] }),
  delete: vi.fn().mockResolvedValue(undefined),
};

import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let dashboard: Dashboard;

  beforeEach(() => {
    vi.clearAllMocks();
    dashboard = new Dashboard({ CAPITAL_DB: mockDB as any, CAPITAL_KV: mockKV as any });
  });

  it('should return aggregated stats', async () => {
    const stats = await dashboard.getAggregatedStats();
    expect(stats).toHaveProperty('timestamp');
    expect(stats).toHaveProperty('summary');
    expect(stats).toHaveProperty('modules');
    expect(stats).toHaveProperty('actions');
  });

  it('should handle default periods in revenue breakdown', async () => {
    const revenue = await dashboard.getRevenueBreakdown('30d');
    expect(revenue).toHaveProperty('period', '30d');
    expect(revenue).toHaveProperty('breakdown');
  });

  it('should return recent activity', async () => {
    const activity = await dashboard.getRecentActivity(10);
    expect(Array.isArray(activity)).toBe(true);
  });
});

import { HealthMonitor } from './health';

describe('HealthMonitor', () => {
  let health: HealthMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    health = new HealthMonitor({ CAPITAL_DB: mockDB as any, CAPITAL_KV: mockKV as any });
  });

  it('should run all checks without throwing', async () => {
    const results = await health.runAllChecks();
    expect(results).toHaveProperty('database');
    expect(results).toHaveProperty('yield-vault');
    expect(results).toHaveProperty('mev-arbitrage');
  });

  it('should mark database healthy when D1 responds', async () => {
    const result = await health.checkModule('database');
    expect(result.module).toBe('database');
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('should handle auto-recovery gracefully', async () => {
    const result = await health.autoRecover();
    expect(result).toHaveProperty('recovered');
    expect(result).toHaveProperty('failed');
  });
});

import { Orchestrator } from './orchestrator';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new Orchestrator({ CAPITAL_DB: mockDB as any, CAPITAL_KV: mockKV as any });
  });

  it('should dispatch actions', async () => {
    const action = await orchestrator.dispatchAction({
      action: 'test',
      module: 'yield-vault',
      params: { amount: '100' },
    });

    expect(action).toHaveProperty('id');
    expect(action.action).toBe('test');
    expect(action.module).toBe('yield-vault');
  });

  it('should list actions', async () => {
    const actions = await orchestrator.listActions();
    expect(Array.isArray(actions)).toBe(true);
  });

  it('should get module status', async () => {
    const status = await orchestrator.getModuleStatus('yield-vault');
    expect(status).toHaveProperty('module', 'yield-vault');
  });
});
