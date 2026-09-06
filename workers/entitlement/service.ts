import { createLogger, LogLevel } from '../../shared/logger';
import type { D1Database } from '@cloudflare/workers-types';

export interface Entitlement {
  did: string;
  balance_usdc: string;
  balance_love: string;
  tier: string;
  monthly_allowance_usdc: string;
  monthly_used_usdc: string;
  last_updated: number;
  created_at: number;
}

export interface TierLimits {
  tier: string;
  monthly_allowance_usdc: string;
  monthly_calls_per_tool: number;
  burst_multiplier: number;
}

export interface UsageStats {
  did: string;
  tool_id: string;
  period_start: number;
  period_end: number;
  call_count: number;
  total_spent_usdc: string;
}

export interface CheckResult {
  ok: boolean;
  balance?: Entitlement;
  monthly_remaining?: string;
  message: string;
}

export interface ConsumeResult {
  id: string;
  did: string;
  tool_id: string;
  amount_usdc: string;
  tx_hash: string;
  status: string;
  new_balance_usdc: string;
  created_at: number;
}

export class EntitlementService {
  private db: D1Database;
  private logger: ReturnType<typeof createLogger>;

  constructor(db: D1Database, env: EnvLike) {
    this.db = db;
    this.logger = createLogger('entitlement', env.ENVIRONMENT);
  }

  async getEntitlement(did: string): Promise<Entitlement | null> {
    const result = await this.db
      .prepare('SELECT * FROM entitlements WHERE did = ?')
      .bind(did)
      .first<Entitlement>();

    if (result) {
      return result;
    }

    const now = Date.now();
    const newEntitlement: Entitlement = {
      did,
      balance_usdc: '0',
      balance_love: '0',
      tier: 'free',
      monthly_allowance_usdc: '0',
      monthly_used_usdc: '0',
      last_updated: now,
      created_at: now,
    };

    await this.db
      .prepare(
        'INSERT INTO entitlements (did, balance_usdc, balance_love, tier, monthly_allowance_usdc, monthly_used_usdc, last_updated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        did,
        newEntitlement.balance_usdc,
        newEntitlement.balance_love,
        newEntitlement.tier,
        newEntitlement.monthly_allowance_usdc,
        newEntitlement.monthly_used_usdc,
        now,
        now
      )
      .run();

    this.logger.info('Entitlement created', { did, tier: 'free' });
    return newEntitlement;
  }

  async checkEntitlement(did: string, toolId: string, estimatedCostUsdc: string): Promise<CheckResult> {
    const entitlement = await this.getEntitlement(did);

    if (!entitlement) {
      return {
        ok: false,
        message: 'DID not found',
      };
    }

    const tierLimits = await this.getTierLimits(entitlement.tier);
    const monthlyAllowance = tierLimits.monthly_allowance_usdc;
    const monthlyUsed = entitlement.monthly_used_usdc;
    const monthlyRemaining = this.subtractStrings(monthlyAllowance, monthlyUsed);
    const balance = entitlement.balance_usdc;
    const loveBalance = entitlement.balance_love;

    const balanceSufficient = this.compareStrings(balance, estimatedCostUsdc) >= 0;
    const loveHasAny = this.compareStrings(loveBalance, '0') > 0;
    const monthlySufficient = this.compareStrings(monthlyRemaining, estimatedCostUsdc) >= 0;

    if (!balanceSufficient && !loveHasAny) {
      this.logger.warn('Insufficient balance', { did, balance, loveBalance, required: estimatedCostUsdc });
      return {
        ok: false,
        balance: entitlement,
        monthly_remaining: monthlyRemaining,
        message: `Insufficient balance: ${balance} USDC available, LOVE token required`,
      };
    }

    if (!monthlySufficient) {
      this.logger.warn('Monthly allowance exceeded', { did, monthlyUsed, allowance: monthlyAllowance });
      return {
        ok: false,
        balance: entitlement,
        monthly_remaining: monthlyRemaining,
        message: `Monthly allowance exceeded: ${monthlyRemaining} USDC remaining`,
      };
    }

    this.logger.info('Entitlement check passed', { did, toolId, balance, monthlyRemaining });

    return {
      ok: true,
      balance: entitlement,
      monthly_remaining: monthlyRemaining,
      message: 'Entitlement check passed',
    };
  }

  async consumeEntitlement(did: string, toolId: string, amountUsdc: string, txHash: string): Promise<ConsumeResult> {
    const existing = await this.db
      .prepare('SELECT * FROM consume_tx_log WHERE tx_hash = ?')
      .bind(txHash)
      .first<any>();

    if (existing) {
      this.logger.info('Idempotent consume - tx already processed', { txHash, did });

      const result = await this.db
        .prepare('SELECT * FROM entitlements WHERE did = ?')
        .bind(did)
        .first<Entitlement>();

      return {
        id: existing.tx_hash,
        did,
        tool_id: toolId,
        amount_usdc: existing.amount_usdc,
        tx_hash: existing.tx_hash,
        status: existing.status,
        new_balance_usdc: result?.balance_usdc || '0',
        created_at: existing.created_at,
      };
    }

    const entitlement = await this.getEntitlement(did);

    if (!entitlement) {
      throw new Error('Entitlement not found for DID');
    }

    const newBalanceUsdc = this.subtractStrings(entitlement.balance_usdc, amountUsdc);
    const newMonthlyUsed = this.addStrings(entitlement.monthly_used_usdc, amountUsdc);
    const now = Date.now();

    await this.db
      .prepare(
        'UPDATE entitlements SET balance_usdc = ?, monthly_used_usdc = ?, last_updated = ? WHERE did = ?'
      )
      .bind(newBalanceUsdc, newMonthlyUsed, now, did)
      .run();

    await this.db
      .prepare(
        'INSERT INTO consume_tx_log (tx_hash, did, tool_id, amount_usdc, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(txHash, did, toolId, amountUsdc, 'consumed', now)
      .run();

    await this.upsertUsageMeter(did, toolId, amountUsdc);

    this.logger.info('Entitlement consumed', {
      did,
      toolId,
      amountUsdc,
      txHash,
      newBalanceUsdc,
    });

    return {
      id: txHash,
      did,
      tool_id: toolId,
      amount_usdc: amountUsdc,
      tx_hash: txHash,
      status: 'consumed',
      new_balance_usdc: newBalanceUsdc,
      created_at: now,
    };
  }

  async setTier(did: string, tier: string): Promise<{ did: string; tier: string; monthly_allowance_usdc: string }> {
    const entitlement = await this.getEntitlement(did);

    if (!entitlement) {
      throw new Error('Entitlement not found for DID');
    }

    const tierLimits = await this.getTierLimits(tier);
    const now = Date.now();

    await this.db
      .prepare(
        'UPDATE entitlements SET tier = ?, monthly_allowance_usdc = ?, monthly_used_usdc = ?, last_updated = ? WHERE did = ?'
      )
      .bind(tier, tierLimits.monthly_allowance_usdc, '0', now, did)
      .run();

    this.logger.info('Tier set', { did, tier, allowance: tierLimits.monthly_allowance_usdc });

    return {
      did,
      tier,
      monthly_allowance_usdc: tierLimits.monthly_allowance_usdc,
    };
  }

  async issueLOVE(did: string, amount: string): Promise<{ did: string; balance_love: string }> {
    const entitlement = await this.getEntitlement(did);
    if (!entitlement) {
      throw new Error('Entitlement not found for DID');
    }

    const current = entitlement.balance_love || '0';
    const newBalance = this.addStrings(current, amount);
    const now = Date.now();

    await this.db
      .prepare('UPDATE entitlements SET balance_love = ?, last_updated = ? WHERE did = ?')
      .bind(newBalance, now, did)
      .run();

    this.logger.info('LOVE issued', { did, amount, newBalance });

    return { did, balance_love: newBalance };
  }

  async resetMonthlyUsage(): Promise<{ rowsUpdated: number }> {
    const result = await this.db
      .prepare('UPDATE entitlements SET monthly_used_usdc = ?')
      .bind('0')
      .run();

    const rowsUpdated = result.meta?.changes || 0;
    this.logger.info('Monthly entitlement reset', { rows_updated: rowsUpdated });

    return { rowsUpdated };
  }

  async getUsage(did: string, toolId: string): Promise<UsageStats[]> {
    const now = Date.now();
    const periodStart = new Date(now);
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodStartTs = periodStart.getTime();
    const periodEndTs = now;

    const results = await this.db
      .prepare(
        'SELECT * FROM usage_meter WHERE did = ? AND tool_id = ? AND period_start = ? AND period_end = ?'
      )
      .bind(did, toolId, periodStartTs, periodEndTs)
      .all<UsageStats>();

    return results.results || [];
  }

  async getTierLimits(tier: string): Promise<TierLimits> {
    const result = await this.db
      .prepare('SELECT * FROM tier_limits WHERE tier = ?')
      .bind(tier)
      .first<TierLimits>();

    if (!result) {
      return {
        tier: 'free',
        monthly_allowance_usdc: '0',
        monthly_calls_per_tool: 100,
        burst_multiplier: 1.0,
      };
    }

    return result;
  }

  private async upsertUsageMeter(did: string, toolId: string, amountUsdc: string): Promise<void> {
    const now = Date.now();
    const periodStart = new Date(now);
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const periodStartTs = periodStart.getTime();

    const existing = await this.db
      .prepare(
        'SELECT * FROM usage_meter WHERE did = ? AND tool_id = ? AND period_start = ? AND period_end = ?'
      )
      .bind(did, toolId, periodStartTs, now)
      .first<UsageStats & { id: string }>();

    if (existing) {
      const newTotal = this.addStrings(existing.total_spent_usdc, amountUsdc);
      await this.db
        .prepare(
          'UPDATE usage_meter SET call_count = call_count + 1, total_spent_usdc = ? WHERE id = ?'
        )
        .bind(newTotal, existing.id)
        .run();
    } else {
      const id = `${did}:${toolId}:${periodStartTs}`;
      await this.db
        .prepare(
          'INSERT INTO usage_meter (id, did, tool_id, period_start, period_end, call_count, total_spent_usdc) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(id, did, toolId, periodStartTs, now, 1, amountUsdc)
        .run();
    }
  }

  private addStrings(a: string, b: string): string {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    const sum = numA + numB;
    return sum.toFixed(2);
  }

  private subtractStrings(a: string, b: string): string {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    const diff = numA - numB;
    return Math.max(0, diff).toFixed(2);
  }

  private compareStrings(a: string, b: string): number {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (numA > numB) return 1;
    if (numA < numB) return -1;
    return 0;
  }
}

export interface EnvLike {
  ENVIRONMENT: string;
}
