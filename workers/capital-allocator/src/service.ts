import { createLogger } from '../../../shared/logger';
import type { Allocation, AllocationResult, AllocateRequest, Env, RebalanceResult } from '../sdk/types';

export class CapitalAllocator {
  private db: D1Database;
  private logger: ReturnType<typeof createLogger>;
  private env: Env;

  constructor(db: D1Database, logger: ReturnType<typeof createLogger>, env: Env) {
    this.db = db;
    this.logger = logger;
    this.env = env;
  }

  async ensureSchema(): Promise<void> {
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS allocations (
          id TEXT PRIMARY KEY,
          source_tx_id TEXT NOT NULL,
          amount_usdc TEXT NOT NULL,
          target TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          roi_bps INTEGER,
          result_tx_hash TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          next_rebalance_at INTEGER
        )
      `);

      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS allocation_results (
          id TEXT PRIMARY KEY,
          allocation_id TEXT NOT NULL,
          status TEXT NOT NULL,
          roi_bps INTEGER,
          tx_hash TEXT,
          completed_at INTEGER NOT NULL,
          error TEXT
        )
      `);

      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations(status)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_allocations_target ON allocations(target)`);
      await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_allocations_roi ON allocations(roi_bps DESC)`);
    } catch (e) {
      this.logger?.warn('Schema ensure failed (may already exist)', { error: (e as Error).message });
    }
  }

  async allocate(request: AllocateRequest): Promise<Allocation[]> {
    await this.ensureSchema();

    const { source_tx_id, amount_usdc, targets } = request;
    const totalWeight = targets.reduce((sum, t) => sum + t.weight, 0);
    const allocations: Allocation[] = [];
    const now = Date.now();

    for (const t of targets) {
      const weightFraction = t.weight / totalWeight;
      const amount = String(Math.round(parseFloat(amount_usdc) * weightFraction * 100) / 100);
      const id = crypto.randomUUID();

      await this.db.prepare(`
        INSERT INTO allocations (id, source_tx_id, amount_usdc, target, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).bind(id, source_tx_id, amount, t.target, now).run();

      allocations.push({
        id,
        amount,
        target: t.target as Allocation['target'],
        status: 'pending',
        created_at: now,
      });
    }

    this.logger.info('Allocations created', {
      source_tx_id,
      total_amount: amount_usdc,
      count: allocations.length,
    });

    return allocations;
  }

  async getStatus(target: string): Promise<{
    target: string;
    current_allocation: string;
    roi_bps: number;
    health_check: string;
  }> {
    await this.ensureSchema();

    const allocationResult = await this.db.prepare(`
      SELECT SUM(CAST(amount_usdc AS REAL)) as total
      FROM allocations
      WHERE target = ? AND status != 'failed'
    `).bind(target).first<{ total: number | null }>();

    const roiResult = await this.db.prepare(`
      SELECT AVG(roi_bps) as avg_roi
      FROM allocation_results
      WHERE allocation_id IN (
        SELECT id FROM allocations WHERE target = ?
      )
    `).bind(target).first<{ avg_roi: number | null }>();

    const totalAllocation = allocationResult?.total || 0;
    const roiBps = roiResult?.avg_roi || 0;
    const healthCheck = totalAllocation > 0 ? (roiBps >= 0 ? 'healthy' : 'underperforming') : 'no_activity';

    return {
      target,
      current_allocation: String(totalAllocation),
      roi_bps: Math.round(roiBps),
      health_check: healthCheck,
    };
  }

  async getRoi(range: string): Promise<{
    roi_by_target: Record<string, number>;
  }> {
    await this.ensureSchema();

    const rangeMs: Record<string, number> = {
      '1d': 86400000,
      '7d': 7 * 86400000,
      '30d': 30 * 86400000,
      '90d': 90 * 86400000,
      '1y': 365 * 86400000,
    };
    const cutoff = Date.now() - (rangeMs[range] || rangeMs['30d']);

    const results = await this.db.prepare(`
      SELECT a.target, AVG(ar.roi_bps) as avg_roi
      FROM allocation_results ar
      JOIN allocations a ON ar.allocation_id = a.id
      WHERE ar.completed_at >= ?
      GROUP BY a.target
    `).bind(cutoff).all<{ target: string; avg_roi: number | null }>();

    const roiByTarget: Record<string, number> = {};
    for (const row of results.results || []) {
      roiByTarget[row.target] = Math.round(row.avg_roi || 0);
    }

    return { roi_by_target: roiByTarget };
  }

  async rebalance(): Promise<RebalanceResult> {
    await this.ensureSchema();

    const roiData = await this.getRoi('30d');
    const roiByTarget = roiData.roi_by_target;

    const targets = Object.keys(roiByTarget);
    if (targets.length === 0) {
      return { rebalance_id: crypto.randomUUID(), moves: [] };
    }

    const avgRoi = targets.reduce((sum, t) => sum + roiByTarget[t], 0) / targets.length;
    const underperformers = targets.filter(t => roiByTarget[t] < avgRoi);
    const overperformers = targets.filter(t => roiByTarget[t] >= avgRoi);

    const moves: Array<{ from: string; to: string; amount: string; reason: string }> = [];
    const rebalanceId = crypto.randomUUID();
    const now = Date.now();

    if (underperformers.length > 0 && overperformers.length > 0) {
      for (const from of underperformers) {
        const fromAmountResult = await this.db.prepare(`
          SELECT SUM(CAST(amount_usdc AS REAL)) as total
          FROM allocations
          WHERE target = ? AND status != 'failed'
        `).bind(from).first<{ total: number | null }>();

        const fromAmount = fromAmountResult?.total || 0;
        if (fromAmount <= 0) continue;

        const deficit = avgRoi - roiByTarget[from];
        const moveFraction = Math.min(deficit / (avgRoi || 1), 0.5);
        const moveAmount = String(Math.round(fromAmount * moveFraction * 100) / 100);

        const to = overperformers[Math.floor(Math.random() * overperformers.length)];

        await this.db.prepare(`
          UPDATE allocations
          SET amount_usdc = CAST(amount_usdc AS REAL) - CAST(? AS REAL),
              next_rebalance_at = ?
          WHERE target = ? AND status != 'failed'
          LIMIT 1
        `).bind(moveAmount, now + 86400000, from).run();

        await this.db.prepare(`
          UPDATE allocations
          SET amount_usdc = CAST(amount_usdc AS REAL) + CAST(? AS REAL),
              next_rebalance_at = ?
          WHERE target = ? AND status != 'failed'
          LIMIT 1
        `).bind(moveAmount, now + 86400000, to).run();

        moves.push({ from, to, amount: moveAmount, reason: `ROI divergence: ${roiByTarget[from]} bps vs ${avgRoi} bps avg` });

        if (this.env.REVENUE_LEDGER_URL) {
          fetch(`${this.env.REVENUE_LEDGER_URL}/revenue/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: 'rebalance',
              payer_did: 'system',
              merchant_did: 'capital-allocator',
              amount_usdc: moveAmount,
              asset: 'USDC',
              metadata: {
                action: 'rebalance',
                from_target: from,
                to_target: to,
                reason: `ROI divergence: ${roiByTarget[from]} bps vs ${avgRoi} bps avg`,
                rebalance_id: rebalanceId,
              },
            }),
          }).catch((err) => this.logger.warn('Failed to record rebalance in revenue ledger', { error: err.message }));
        }
      }
    }

    this.logger.info('Rebalance executed', {
      rebalance_id: rebalanceId,
      moves_count: moves.length,
      targets_evaluated: targets.length,
    });

    return { rebalance_id: rebalanceId, moves };
  }
}
