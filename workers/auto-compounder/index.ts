/**
 * P31 Auto-Compounder — clean rewrite.
 * Serves the capital-machine positions contract and runs a 6-hourly
 * compound cron against the capital-db vault tables.
 *
 *   GET  /positions → { positions: [{ id, chain, protocol, amount, apy_bps, created_at }] }
 *   GET  /health    → { status: 'ok', service }
 *   GET  /metrics   → { positions, service }
 *   POST /compound  → manual compound run
 *   cron every 6h  → harvest yield into compound_history + grow deposits
 */
interface Env {
  CAPITAL_DB: D1Database;
}

interface Position {
  id: string;
  chain: string;
  protocol: string;
  amount: string;
  apy_bps: number;
  created_at: number;
}

const SERVICE = 'p31-auto-compounder';
const VERSION = '2.0.0';

// Yield window per compound run: 6 hours as a fraction of a 365-day year.
const COMPOUND_FRACTION = 6 / (24 * 365);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function fetchPositions(db: D1Database): Promise<Position[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id,
              d.chain,
              d.amount,
              d.created_at,
              COALESCE((SELECT s.protocol FROM vault_strategies s WHERE s.chain = d.chain AND s.active = 1 ORDER BY s.id LIMIT 1), 'vault') AS protocol,
              COALESCE((SELECT s.apy_bps  FROM vault_strategies s WHERE s.chain = d.chain AND s.active = 1 ORDER BY s.id LIMIT 1), 0) AS apy_bps
         FROM vault_deposits d
        WHERE d.status = 'active'
        ORDER BY d.created_at DESC`,
    )
    .all();

  return (results as unknown[]).map((r) => {
    const row = r as Record<string, string | number>;
    return {
      id: String(row.id),
      chain: String(row.chain),
      protocol: String(row.protocol),
      amount: String(row.amount),
      apy_bps: Number(row.apy_bps ?? 0),
      created_at: Number(row.created_at),
    };
  });
}

/** Compounder run: grow each active deposit by its strategy APY over one window. */
async function compound(db: D1Database): Promise<{ compounded: number; totalYield: string }> {
  const positions = await fetchPositions(db);
  const now = Math.floor(Date.now() / 1000);
  let compounded = 0;
  let totalYield = 0;

  for (const p of positions) {
    const amount = Number(p.amount) || 0;
    const yieldRate = (p.apy_bps / 10000) * COMPOUND_FRACTION;
    const reward = amount * yieldRate;
    if (reward <= 0) continue;

    const newTotal = amount + reward;
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO compound_history (id, position_id, chain, reward_amount, gas_cost, new_total, status, tx_hash, compounded_at)
         VALUES (?, ?, ?, ?, '0', ?, 'compounded', NULL, ?)`,
      )
      .bind(id, p.id, p.chain, reward.toFixed(6), newTotal.toFixed(6), now)
      .run();

    await db
      .prepare('UPDATE vault_deposits SET amount = ?, updated_at = ? WHERE id = ? AND status = ?')
      .bind(newTotal.toFixed(6), now, p.id, 'active')
      .run();

    compounded += 1;
    totalYield += reward;
  }

  return { compounded, totalYield: totalYield.toFixed(6) };
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const result = await compound(env.CAPITAL_DB);
    console.log(`compound run: ${result.compounded} position(s), ${result.totalYield} yield`);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (path === '/health' && method === 'GET') {
        return json({ status: 'ok', service: SERVICE, version: VERSION });
      }

      if (path === '/metrics' && method === 'GET') {
        const positions = await fetchPositions(env.CAPITAL_DB);
        return json({ positions: positions.length, service: SERVICE, version: VERSION });
      }

      if (path === '/positions' && method === 'GET') {
        const positions = await fetchPositions(env.CAPITAL_DB);
        return json({ positions });
      }

      if (path === '/compound' && method === 'POST') {
        const result = await compound(env.CAPITAL_DB);
        return json({ ok: true, ...result });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
    }
  },
};