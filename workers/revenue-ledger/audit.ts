export class AuditTrail {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async ensureSchema() {
    await this.db.exec("CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, actor_did TEXT, action TEXT NOT NULL, target TEXT, metadata TEXT, hash TEXT NOT NULL, previous_hash TEXT NOT NULL, UNIQUE(hash))");
    await this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_prev_hash ON audit_events(previous_hash)");
  }

  async record(event: {
    event_type: string;
    actor_did?: string;
    action: string;
    target?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    await this.ensureSchema();

    const id = crypto.randomUUID();
    const timestamp = Date.now();

    // Same linearization as the revenue ledger: a UNIQUE index on
    // previous_hash means at most one event may claim a given predecessor, so
    // exactly one concurrent writer wins per audit-chain head; losers surface
    // SQLITE_CONSTRAINT and retry against the winner's committed head.
    for (let attempt = 0; attempt < 32; attempt++) {
      const prev = await this.db.prepare(
        'SELECT hash FROM audit_events ORDER BY timestamp DESC, rowid DESC LIMIT 1'
      ).first<{ hash: string }>();
      const previousHash = prev?.hash || 'genesis';

      const data = `${id}:${timestamp}:${event.event_type}:${event.action}:${previousHash}`;
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      try {
        await this.db.prepare(`
          INSERT INTO audit_events (id, timestamp, event_type, actor_did, action, target, metadata, hash, previous_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, timestamp, event.event_type, event.actor_did || null,
          event.action, event.target || null,
          JSON.stringify(event.metadata || {}), hash, previousHash
        ).run();

        return hash;
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
          /previous_hash/i.test(msg) ||
          msg.includes('7500') ||
          msg.includes('audit_events.hash');

        if (!isConstraint) {
          throw e;
        }
        // Lost the append to a concurrent writer; retry against new head.
      }
    }

    throw new Error('audit chain append contended 32 times; try again');
  }

  async logEvent(event_type: string, metadata?: Record<string, any>): Promise<string> {
    return this.record({
      event_type,
      actor_did: metadata?.actor_did || metadata?.merchant_did || 'system',
      action: event_type,
      target: metadata?.id ? String(metadata.id) : undefined,
      metadata,
    });
  }

  async getEvents(
    event_type?: string,
    actor_did?: string,
    since?: string,
    limit: number = 100
  ): Promise<any[]> {
    return this.query({
      event_type: event_type || undefined,
      actor_did: actor_did || undefined,
      since: since ? parseInt(since, 10) || undefined : undefined,
      limit,
    });
  }

  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt?: string }> {
    return this.verifyChain();
  }

  async query(filters: {
    event_type?: string;
    actor_did?: string;
    action?: string;
    since?: number;
    limit?: number;
  }): Promise<any[]> {
    await this.ensureSchema();

    let sql = 'SELECT * FROM audit_events WHERE 1=1';
    const params: any[] = [];

    if (filters.event_type) { sql += ' AND event_type = ?'; params.push(filters.event_type); }
    if (filters.actor_did) { sql += ' AND actor_did = ?'; params.push(filters.actor_did); }
    if (filters.action) { sql += ' AND action = ?'; params.push(filters.action); }
    if (filters.since) { sql += ' AND timestamp >= ?'; params.push(filters.since); }

    sql += ' ORDER BY timestamp DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }

    const results = await this.db.prepare(sql).bind(...params).all();
    return results.results || [];
  }

  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string }> {
    await this.ensureSchema();
    const events = await this.db.prepare(
      'SELECT id, hash, previous_hash FROM audit_events'
    ).all<any>();

    const byPrev = new Map<string, any>();
    for (const event of events.results || []) {
      byPrev.set(event.previous_hash, event);
    }

    const visited = new Map<string, string>();
    let cursor = 'genesis';
    while (true) {
      const event = byPrev.get(cursor);
      if (!event) break;
      if (visited.has(event.hash)) {
        return { valid: false, brokenAt: event.id };
      }
      visited.set(event.hash, event.id);
      cursor = event.hash;
    }

    if (visited.size !== (events.results || []).length) {
      return { valid: false, brokenAt: 'unreachable' };
    }
    return { valid: true };
  }
}
