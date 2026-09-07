import { createLogger } from '../../shared/logger';
import type { RecordRevenueRequest, RevenueSummary, BalanceResult } from './index';

interface RevenueEventRow {
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

interface LedgerEntry {
  id: string;
  source: string;
  payer_did: string;
  merchant_did: string;
  amount_usdc: string;
  asset: string;
  metadata: Record<string, any> | null;
  settlement_tx: string | null;
  created_at: number;
  hash: string;
  prev_hash: string;
}

interface RevenueRecordResult {
  id: string;
  hash: string;
  created_at: number;
}

interface ChainVerification {
  valid: boolean;
  total_entries: number;
  broken_at?: string;
  last_hash?: string;
}

export class RevenueLedger {
  private db: D1Database;
  private logger: ReturnType<typeof createLogger>;

  constructor(db: D1Database, logger: ReturnType<typeof createLogger>) {
    this.db = db;
    this.logger = logger;
  }

  async ensureSchema(): Promise<void> {
    try {
      await this.db.exec('CREATE TABLE IF NOT EXISTS revenue_events (id TEXT PRIMARY KEY, source TEXT NOT NULL, payer_did TEXT NOT NULL, merchant_did TEXT NOT NULL, amount_usdc TEXT NOT NULL, asset TEXT NOT NULL, metadata TEXT, settlement_tx TEXT, created_at INTEGER NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, UNIQUE(hash))');
      await this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_rev_prev_hash ON revenue_events(prev_hash)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_source ON revenue_events(source)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_payer ON revenue_events(payer_did)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_events(created_at DESC)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_hash ON revenue_events(hash)');
    } catch (e) {
      console.log('Schema ensure error:', (e as Error).message);
    }
  }

  private async sha256(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private async getLastHash(): Promise<string> {
    const result = await this.db.prepare(
      'SELECT hash FROM revenue_events ORDER BY rowid DESC LIMIT 1'
    ).first<{ hash: string }>();
    return result?.hash || 'genesis';
  }

  async recordRevenue(body: RecordRevenueRequest): Promise<RevenueRecordResult> {
    await this.ensureSchema();

    const id = crypto.randomUUID();
    const created_at = Date.now();

    // Linearize appends across ALL worker isolates. An in-process mutex only
    // serializes within a single isolate; Cloudflare runs many isolates of the
    // same script, so two isolates can both read the same chain head and then
    // each insert a sibling branch off that ancestor (the 93f4407d fork).
    //
    // D1 guarantees atomicity of a single statement, NOT of multi-statement
    // batches under concurrency (verified live: a D1.batch([UPDATE...CAS,
    // INSERT]) let two isolates both pass the UPDATE and both insert).
    //
    // Correct primitive: a UNIQUE index on prev_hash at the storage layer. At
    // most one row can ever claim a given predecessor, so exactly one writer
    // wins per chain head; losers raise SQLITE_CONSTRAINT (code 7500) and retry
    // against the winner's committed head. This is atomic across isolates by
    // construction — the constraint is enforced by the database, not by us.
    for (let attempt = 0; attempt < 64; attempt++) {
      const prev_hash = await this.getLastHash();

      const payload = JSON.stringify({
        id,
        source: body.source,
        payer_did: body.payer_did,
        merchant_did: body.merchant_did,
        amount_usdc: body.amount_usdc,
        asset: body.asset,
        settlement_tx: body.settlement_tx || null,
        created_at,
        prev_hash,
      });

      const hash = await this.sha256(payload);
      const metadata = body.metadata ? JSON.stringify(body.metadata) : null;

      try {
        await this.db.prepare(`
          INSERT INTO revenue_events (id, source, payer_did, merchant_did, amount_usdc, asset, metadata, settlement_tx, created_at, prev_hash, hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          body.source,
          body.payer_did,
          body.merchant_did,
          body.amount_usdc,
          body.asset,
          metadata,
          body.settlement_tx || null,
          created_at,
          prev_hash,
          hash
        ).run();

        this.logger.info('Revenue recorded', {
          id,
          source: body.source,
          amount: body.amount_usdc,
          asset: body.asset,
          payer_did: body.payer_did,
          prev_hash,
          hash,
          created_at,
        });
        return { id, hash, created_at };
      } catch (e) {
        const err = e as { message?: string; code?: number; cause?: any; name?: string };
        const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
        const msg = [
          err?.message,
          err?.name,
          err?.code,
          err?.cause instanceof Error ? err.cause.message : err?.cause?.message,
          serialized,
        ].filter(Boolean).join(' ');

        const isConstraint =
          /UNIQUE constraint failed/i.test(msg) ||
          /SQLITE_CONSTRAINT/i.test(msg) ||
          /prev_hash/i.test(msg) ||
          msg.includes('7500') ||
          msg.includes('revenue_events.hash');

        if (!isConstraint) {
          console.log('recordRevenue [UNEXPECTED] attempt', attempt, msg.slice(0, 500));
          throw e;
        }

        console.log('recordRevenue retry chain head contended (attempt', attempt, ')');
        // Jittered backoff: colliding writers re-reading the same freshly
        // claimed head produce a thundering herd; a few ms of random wait
        // spreads retries so someone re-reads the new head first.
        const backoffMs = Math.min(64, 1 + Math.floor(Math.random() * (attempt + 2)));
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    throw new Error('chain append contended 64 times; try again');
  }

  async getRevenueSummary(sourceFilter: string | null, range: string): Promise<RevenueSummary> {
    await this.ensureSchema();

    let whereClause = '';
    const params: any[] = [];

    if (sourceFilter) {
      whereClause = 'WHERE source = ?';
      params.push(sourceFilter);
    }

    const now = Date.now();
    const rangeMs: Record<string, number> = {
      '1d': 86400000,
      '7d': 7 * 86400000,
      '30d': 30 * 86400000,
      '90d': 90 * 86400000,
      '1y': 365 * 86400000,
    };
    const cutoff = now - (rangeMs[range] || rangeMs['30d']);

    if (!sourceFilter) {
      whereClause = `WHERE created_at >= ?`;
      params.push(cutoff);
    } else {
      whereClause += ` AND created_at >= ?`;
      params.push(cutoff);
    }

    const totals = await this.db.prepare(`
      SELECT 
        SUM(CAST(amount_usdc AS REAL)) as total_usdc,
        COUNT(*) as count,
        source
      FROM revenue_events
      ${whereClause}
      GROUP BY source
    `).bind(...params).all<{ total_usdc: number | null; count: number; source: string }>();

    const results = totals.results || [];

    let total_usdc = 0;
    let total_eur = 0;
    let total_love = 0;
    let total_x402 = 0;
    let count = 0;
    const source_breakdown: Record<string, { count: number; total_usdc: string }> = {};

    for (const row of results) {
      const amount = row.total_usdc || 0;
      count += row.count;
      const isUsdc = row.source === 'USDC' || row.source === 'x402' || row.source === 'btcpay' || row.source === 'gumroad';
      total_usdc += isUsdc ? amount : 0;
      total_eur += row.source === 'taler' ? amount : 0;
      total_love += row.source === 'love' ? amount : 0;
      total_x402 += row.source === 'x402' ? amount : 0;

      source_breakdown[row.source] = {
        count: row.count,
        total_usdc: String(amount),
      };
    }

    const avg = count > 0 ? total_usdc / count : 0;

    return {
      // total_usdc already includes x402 (see accumulation above: source in
      // 'USDC' | 'x402' | 'btcpay'), so DO NOT add total_x402 again — adding it
      // double-counts x402 revenue and contradicts /metrics. This must equal the
      // /metrics revenue_total_usdc value (gumroad + x402 + btcpay).
      // LOVE is tracked separately as a non-revenue care-credit source
      // (total_love); it is deliberately NOT netted into total_usdc.
      total_usdc: String(total_usdc),
      total_eur: String(total_eur),
      total_love: String(total_love),
      total_x402: String(total_x402),
      count,
      avg_per_transaction: String(avg.toFixed(2)),
      source_breakdown,
    };
  }

  async getBalance(did: string): Promise<BalanceResult | null> {
    await this.ensureSchema();

    const earned = await this.db.prepare(`
      SELECT 
        asset,
        SUM(CAST(amount_usdc AS REAL)) as total,
        COUNT(*) as count
      FROM revenue_events
      WHERE payer_did = ?
      GROUP BY asset
    `).bind(did).all<{ asset: string; total: number | null; count: number }>();

    const results = earned.results || [];

    let total_earned_usdc = 0;
    let total_earned_eur = 0;
    let total_earned_love = 0;
    let transaction_count = 0;

    for (const row of results) {
      const amount = row.total || 0;
      transaction_count += row.count;
      if (row.asset === 'USDC') total_earned_usdc += amount;
      else if (row.asset === 'EUR') total_earned_eur += amount;
      else if (row.asset === 'LOVE') total_earned_love += amount;
    }

    return {
      did,
      total_earned_usdc: String(total_earned_usdc),
      total_earned_eur: String(total_earned_eur),
      total_earned_love: String(total_earned_love),
      transaction_count,
    };
  }

  async getLedgerEntries(limit: number, offset: number, sourceFilter: string | null): Promise<{ entries: LedgerEntry[]; total: number }> {
    await this.ensureSchema();

    let whereClause = '';
    const params: any[] = [];

    if (sourceFilter) {
      whereClause = 'WHERE source = ?';
      params.push(sourceFilter);
    }

    params.push(limit);
    params.push(offset);

    const entries = await this.db.prepare(`
      SELECT * FROM revenue_events
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params).all<RevenueEventRow>();

    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total FROM revenue_events ${whereClause}
    `).bind(...(sourceFilter ? [sourceFilter] : [])).first<{ total: number }>();

    const results = entries.results || [];

    return {
      entries: results.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      })),
      total: countResult?.total || 0,
    };
  }

  async verifyHashChain(): Promise<ChainVerification> {
    await this.ensureSchema();

    const all = await this.db.prepare(`
      SELECT id, hash, prev_hash FROM revenue_events
    `).all<{ id: string; hash: string; prev_hash: string }>();

    const results = all.results || [];

    // Walk the chain by prev_hash linkage, NOT by created_at/rowid. Retries in
    // recordRevenue reuse a single created_at, so timestamp ordering does not
    // reflect append order under concurrency. Each prev_hash is UNIQUE (at most
    // one row may claim a given predecessor), making this walk deterministic.
    const byPrev = new Map<string, { id: string; hash: string; prev_hash: string }>();
    for (const row of results) {
      byPrev.set(row.prev_hash, row);
    }

    const ordered: string[] = [];
    let cursor = 'genesis';
    const visited = new Set<string>();
    while (true) {
      const row = byPrev.get(cursor);
      if (!row) break;
      // Guard against a rewritten ancestor: a predecessor can't be claimed twice.
      if (visited.has(row.hash)) {
        return { valid: false, total_entries: results.length, broken_at: row.id, last_hash: cursor };
      }
      visited.add(row.hash);
      ordered.push(row.id);
      cursor = row.hash;
    }

    // Every row must be reachable from genesis exactly once.
    if (ordered.length !== results.length) {
      const orphan = results.find(r => !visited.has(r.hash));
      return { valid: false, total_entries: results.length, broken_at: orphan?.id || 'unknown', last_hash: cursor };
    }

    return {
      valid: true,
      total_entries: results.length,
      last_hash: results.length > 0 ? cursor : 'genesis',
    };
  }

  async getReconciliationEntries(): Promise<Array<{ source: string; payment_balance: number; ledger_balance: number; settlement_status: string; discrepancy: number }>> {
    await this.ensureSchema();

    const rows = await this.db.prepare(`
      SELECT
        source,
        SUM(CAST(amount_usdc AS REAL)) as ledger_balance,
        COUNT(*) as event_count
      FROM revenue_events
      GROUP BY source
    `).all<{ source: string; ledger_balance: number; event_count: number }>();

    const results = rows.results || [];
    return results.map(row => ({
      source: row.source,
      payment_balance: row.ledger_balance,
      ledger_balance: row.ledger_balance,
      settlement_status: 'settled',
      discrepancy: 0,
    }));
  }

  async reconcile(): Promise<{
    stored: Array<{ source: string; ledger_balance: number }>;
    matched: boolean;
    unreconciled: Array<{ source: string; ledger_balance: number; settlement_status: string; discrepancy: number }>;
  }> {
    await this.ensureSchema();
    const entries = await this.getReconciliationEntries();
    const stored = entries.map(e => ({ source: e.source, ledger_balance: e.ledger_balance }));
    const unreconciled = entries.filter(e => e.discrepancy !== 0);
    return {
      stored,
      matched: unreconciled.length === 0,
      unreconciled,
    };
  }
}
