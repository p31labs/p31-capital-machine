export class AuditTrail {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async ensureSchema() {
    await this.db.exec("CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, actor_did TEXT, action TEXT NOT NULL, target TEXT, metadata TEXT, hash TEXT NOT NULL, previous_hash TEXT)");
  }

  async record(event: {
    event_type: string;
    actor_did?: string;
    action: string;
    target?: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    await this.ensureSchema();

    const prev = await this.db.prepare(
      'SELECT hash FROM audit_events ORDER BY timestamp DESC LIMIT 1'
    ).first<{ hash: string }>();
    const previousHash = prev?.hash || 'genesis';

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const data = `${id}:${timestamp}:${event.event_type}:${event.action}:${previousHash}`;
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    await this.db.prepare(`
      INSERT INTO audit_events (id, timestamp, event_type, actor_did, action, target, metadata, hash, previous_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, timestamp, event.event_type, event.actor_did || null,
      event.action, event.target || null,
      JSON.stringify(event.metadata || {}), hash, previousHash
    ).run();

    return hash;
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
      'SELECT * FROM audit_events ORDER BY timestamp ASC'
    ).all<any>();

    let previousHash = 'genesis';
    for (const event of events.results || []) {
      if (event.previous_hash !== previousHash) {
        return { valid: false, brokenAt: event.id };
      }
      previousHash = event.hash;
    }
    return { valid: true };
  }
}
