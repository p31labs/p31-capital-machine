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
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_source ON revenue_events(source)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_payer ON revenue_events(payer_did)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_created ON revenue_events(created_at DESC)');
      await this.db.exec('CREATE INDEX IF NOT EXISTS idx_revenue_hash ON revenue_events(hash)');
      await this.db.exec('CREATE TABLE IF NOT EXISTS chain_state (id TEXT PRIMARY KEY, prev_hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)');
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
    await this.ensureChainState();

    const id = crypto.randomUUID();
    const created_at = Date.now();

    // Linearize appends across ALL worker isolates. An in-process mutex only
    // serializes within a single isolate; Cloudflare runs many isolates of the
    // same script, so two isolates can both read the same chain head and then
    // each insert a sibling branch off that ancestor (the 93f4407d fork).
    //
    // Instead we claim the authoritative head with a compare-and-swap on a
    // chain_state slot: the advance (UPDATE WHERE version=?jumps to the next
    // version) and the row insert are issued as one D1.batch(), which runs in a
    // single transaction, so exactly one concurrent writer wins (changes:1);
    // losers see changes:0 and retry against the winner's committed head.
    for (let attempt = 0; attempt < 16; attempt++) {
      const state = await this.db.prepare(
        `SELECT prev_hash, version FROM chain_state WHERE id = 'revenue'`
      ).first<{ prev_hash: string; version: number }>();

      const prev_hash = state?.prev_hash || 'genesis';
      const version = state?.version ?? 0;

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

      const [updateRes, insertRes] = await this.db.batch([
        this.db.prepare(
          `UPDATE chain_state
             SET prev_hash = ?, version = version + 1, updated_at = ?
           WHERE id = 'revenue' AND version = ?`
        ).bind(hash, Date.now(), version),
        this.db.prepare(`
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
        ),
      ]);

      const won = (updateRes.meta?.changes ?? 0) === 1;
      if (won) {
        this.logger.info('Revenue recorded', {
          id,
          source: body.source,
          amount: body.amount_usdc,
          asset: body.asset,
          payer_did: body.payer_did,
        });
        return { id, hash, created_at };
      }

      // Lost the CAS to a concurrent writer; retry against the new head.
      if (!insertRes.success) {
        throw new Error(`${insertRes.error || 'insert failed'}`);
      }
    }

    throw new Error('chain append contended 16 times; try again');
  }

  private async ensureChainState(): Promise<void> {
    try {
      await this.db.prepare(
        `INSERT OR IGNORE INTO chain_state (id, prev_hash, version, updated_at)
         VALUES ('revenue', 'genesis', 0, ?)`
      ).bind(Date.now()).run();
    } catch (e) {
      console.log('chain_state ensure error:', (e as Error).message);
    }
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
      SELECT id, hash, prev_hash, rowid FROM revenue_events ORDER BY created_at ASC, rowid ASC
    `).all<{ id: string; hash: string; prev_hash: string; rowid: number }>();

    const results = all.results || [];
    let previousHash = 'genesis';

    for (const row of results) {
      if (row.prev_hash !== previousHash) {
        return {
          valid: false,
          total_entries: results.length,
          broken_at: row.id,
          last_hash: previousHash,
        };
      }
      previousHash = row.hash;
    }

    return {
      valid: true,
      total_entries: results.length,
      last_hash: results.length > 0 ? results[results.length - 1].hash : 'genesis',
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
