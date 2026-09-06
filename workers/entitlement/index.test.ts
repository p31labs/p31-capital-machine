import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResults: Map<string, any> = new Map();

function createMockStatement(sql: string) {
  return {
    sql,
    bind: vi.fn(function (this: any, ...args: any[]) {
      this.bindArgs = args;
      return this;
    }),
    async first() {
      const key = this.sql;
      const result = mockResults.get(key);
      if (typeof result === 'function') {
        return result(this.bindArgs);
      }
      return result;
    },
    async all() {
      const key = this.sql;
      const result = mockResults.get(key);
      if (result && result.results) {
        return result;
      }
      return { results: [] };
    },
    async run() {
      return { success: true };
    },
    bindArgs: [] as any[],
  };
}

const mockDB = {
  prepare: vi.fn((sql: string) => createMockStatement(sql)),
  exec: vi.fn().mockResolvedValue(undefined),
};

import { EntitlementService } from './service';

describe('EntitlementService', () => {
  let service: EntitlementService;
  const mockEnv = { ENVIRONMENT: 'test' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResults.clear();
    service = new EntitlementService(mockDB as any, mockEnv);
  });

  describe('getEntitlement', () => {
    it('should return existing entitlement', async () => {
      const existingEntitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        balance_love: '50.00',
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_used_usdc: '10.00',
        last_updated: Date.now(),
        created_at: Date.now() - 86400000,
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', existingEntitlement);

      const result = await service.getEntitlement('did:test:123');
      expect(result).toEqual(existingEntitlement);
    });

    it('should create entitlement if not found', async () => {
      mockResults.set('SELECT * FROM entitlements WHERE did = ?', null);
      mockResults.set(
        'INSERT INTO entitlements (did, balance_usdc, balance_love, tier, monthly_allowance_usdc, monthly_used_usdc, last_updated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        { success: true }
      );

      const result = await service.getEntitlement('did:test:456');

      expect(result).toBeDefined();
      expect(result?.did).toBe('did:test:456');
      expect(result?.tier).toBe('free');
      expect(result?.balance_usdc).toBe('0');
      expect(result?.balance_love).toBe('0');
      expect(result?.monthly_allowance_usdc).toBe('0');
    });
  });

  describe('checkEntitlement', () => {
    it('should pass when balance and monthly allowance are sufficient', async () => {
      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        monthly_used_usdc: '10.00',
        tier: 'pro',
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);
      mockResults.set('SELECT * FROM tier_limits WHERE tier = ?', {
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_calls_per_tool: 1000,
        burst_multiplier: 2.0,
      });

      const result = await service.checkEntitlement('did:test:123', 'tool-1', '10.00');

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Entitlement check passed');
    });

    it('should fail when balance is insufficient', async () => {
      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '5.00',
        monthly_used_usdc: '10.00',
        tier: 'pro',
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);
      mockResults.set('SELECT * FROM tier_limits WHERE tier = ?', {
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_calls_per_tool: 1000,
        burst_multiplier: 2.0,
      });

      const result = await service.checkEntitlement('did:test:123', 'tool-1', '10.00');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Insufficient balance');
    });

    it('should fail when monthly allowance is exceeded', async () => {
      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        monthly_used_usdc: '45.00',
        tier: 'pro',
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);
      mockResults.set('SELECT * FROM tier_limits WHERE tier = ?', {
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_calls_per_tool: 1000,
        burst_multiplier: 2.0,
      });

      const result = await service.checkEntitlement('did:test:123', 'tool-1', '10.00');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Monthly allowance exceeded');
    });
  });

  describe('consumeEntitlement', () => {
    it('should deduct balance and log transaction', async () => {
      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        balance_love: '50.00',
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_used_usdc: '10.00',
        last_updated: Date.now(),
        created_at: Date.now() - 86400000,
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);
      mockResults.set('SELECT * FROM consume_tx_log WHERE tx_hash = ?', null);
      mockResults.set(
        'SELECT * FROM usage_meter WHERE did = ? AND tool_id = ? AND period_start = ? AND period_end = ?',
        null
      );

      const result = await service.consumeEntitlement('did:test:123', 'tool-1', '10.00', 'tx-abc-123');

      expect(result.status).toBe('consumed');
      expect(result.amount_usdc).toBe('10.00');
      expect(result.tx_hash).toBe('tx-abc-123');
    });

    it('should be idempotent for same tx_hash', async () => {
      const existingTx = {
        tx_hash: 'tx-abc-123',
        did: 'did:test:123',
        tool_id: 'tool-1',
        amount_usdc: '10.00',
        status: 'consumed',
        created_at: Date.now(),
      };

      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        balance_love: '50.00',
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_used_usdc: '10.00',
        last_updated: Date.now(),
        created_at: Date.now() - 86400000,
      };

      mockResults.set('SELECT * FROM consume_tx_log WHERE tx_hash = ?', existingTx);
      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);

      const result = await service.consumeEntitlement('did:test:123', 'tool-1', '10.00', 'tx-abc-123');

      expect(result.status).toBe('consumed');
      expect(result.tx_hash).toBe('tx-abc-123');
      expect(result.amount_usdc).toBe('10.00');
    });
  });

  describe('setTier', () => {
    it('should update tier and reset monthly used', async () => {
      const entitlement = {
        did: 'did:test:123',
        balance_usdc: '100.00',
        balance_love: '50.00',
        tier: 'free',
        monthly_allowance_usdc: '0',
        monthly_used_usdc: '5.00',
        last_updated: Date.now(),
        created_at: Date.now() - 86400000,
      };

      mockResults.set('SELECT * FROM entitlements WHERE did = ?', entitlement);
      mockResults.set('SELECT * FROM tier_limits WHERE tier = ?', {
        tier: 'pro',
        monthly_allowance_usdc: '50',
        monthly_calls_per_tool: 1000,
        burst_multiplier: 2.0,
      });

      const result = await service.setTier('did:test:123', 'pro');

      expect(result.tier).toBe('pro');
      expect(result.monthly_allowance_usdc).toBe('50');
    });
  });

  describe('Entitlement Service — Scheduled', () => {
    it('should reset monthly usage on cron trigger', async () => {
      const mockRun = vi.fn().mockResolvedValue({ success: true, meta: { changes: 5 } });
      mockDB.prepare = vi.fn(() => ({ bind: vi.fn(() => ({ run: mockRun })) })) as any;

      const service = new EntitlementService(mockDB as any, mockEnv);
      await service.resetMonthlyUsage();

      expect(mockRun).toHaveBeenCalled();
    });
  });
});
