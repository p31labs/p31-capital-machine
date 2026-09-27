export interface Env {
  CONFIG_DB: D1Database;
  CONFIG_KV: KVNamespace;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS: string;
}

interface ConfigEntry {
  key: string;
  value: string;
  category: string;
  is_secret: number;
  updated_at: number;
}

type ValidatorResult = { ok: boolean; message?: string };

const RPC_CATEGORIES = ['rpc'] as const;
const VAULT_CATEGORIES = ['vault', 'strategy'] as const;

const corsHeaders = (env: Env): Record<string, string> => {
  const allowed = env.ALLOWED_ORIGINS || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
};

function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function isAddress(input: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(input.trim());
}

function isBoolean(input: string): boolean {
  return input === 'true' || input === 'false';
}

async function validateRpc(endpoint: string): Promise<ValidatorResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} from RPC endpoint` };
    const data = await res.json() as { result?: string; error?: { message?: string } };
    if (data.error) return { ok: false, message: data.error.message };
    if (!data.result) return { ok: false, message: 'No chainId returned' };
    return { ok: true, message: `Connected (chainId 0x${BigInt(data.result).toString(16)})` };
  } catch (e) {
    return { ok: false, message: `RPC unreachable: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

async function validateContract(address: string): Promise<ValidatorResult> {
  if (!isAddress(address)) {
    return { ok: false, message: 'Invalid contract address format' };
  }
  return { ok: true, message: 'Address format valid' };
}

function validateValue(category: string, key: string, value: string): ValidatorResult {
  const last = key.split('.').pop()?.toUpperCase() || key.toUpperCase();

  if ((RPC_CATEGORIES as readonly string[]).includes(category)) {
    try {
      new URL(value);
    } catch {
      return { ok: false, message: 'Not a valid URL' };
    }
  }

  if ((VAULT_CATEGORIES as readonly string[]).includes(category)) {
    if (!isAddress(value)) {
      return { ok: false, message: 'Not a valid contract address' };
    }
  }

  if (last.includes('FEATURE') || key.startsWith('features.')) {
    if (!isBoolean(value)) return { ok: false, message: 'Must be true or false' };
  }

  return { ok: true };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cors = corsHeaders(env);

    if (method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });

    try {
      if (path === '/health' && method === 'GET') {
        return json({
          status: 'ok',
          service: 'config-gateway',
          timestamp: Date.now(),
        });
      }

      if (path === '/api/config' && method === 'GET') {
        const { results } = await env.CONFIG_DB.prepare(
          "SELECT key, value, category, updated_at FROM app_config WHERE is_secret = 0 ORDER BY category, key"
        ).all<ConfigEntry>();
        return json({ config: results });
      }

      if (path === '/api/config' && (method === 'PUT' || method === 'POST')) {
        if (!isAdmin(request, env)) {
          return json({ error: 'Unauthorized' }, 401);
        }
        const body = await request.json() as Record<string, { value: string; category?: string; is_secret?: boolean }>;

        const entries: { key: string; value: string; category: string; is_secret: number }[] = [];
        const errors: Record<string, string> = {};

        for (const [key, def] of Object.entries(body)) {
          const category = def.category || 'var';
          const value = String(def.value ?? '');
          const isSecret = def.is_secret ? 1 : 0;

          if (!isSecret) {
            const v = validateValue(category, key, value);
            if (!v.ok) {
              errors[key] = v.message || 'Invalid';
              continue;
            }
          }

          entries.push({ key, value, category, is_secret: isSecret });
        }

        if (Object.keys(errors).length > 0) {
          return json({ error: 'Validation failed', errors }, 400);
        }

        const now = Date.now();
        const tx = env.CONFIG_DB.batch(
          entries.map((e) =>
            env.CONFIG_DB.prepare(
              "INSERT INTO app_config (key, value, category, is_secret, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, is_secret = excluded.is_secret, updated_at = excluded.updated_at"
            ).bind(e.key, e.value, e.category, e.is_secret, now)
          )
        );
        await tx;

        for (const e of entries) {
          if (!e.is_secret) {
            await env.CONFIG_KV.put(`cfg:${e.key}`, e.value, { expirationTtl: 300 });
          }
        }

        return json({ saved: entries.length, updated_at: now });
      }

      if (path === '/api/config/validate' && method === 'POST') {
        if (!isAdmin(request, env)) {
          return json({ error: 'Unauthorized' }, 401);
        }
        const body = await request.json() as { category: string; key: string; value: string };
        const base = validateValue(body.category, body.key, body.value);
        if (!base.ok) return json({ valid: false, message: base.message });

        if (body.category === 'rpc') {
          const rpc = await validateRpc(body.value);
          return json({ valid: rpc.ok, message: rpc.message });
        }
        if (body.category === 'vault' || body.category === 'strategy') {
          const contract = await validateContract(body.value);
          return json({ valid: contract.ok, message: contract.message });
        }
        return json({ valid: true, message: 'Valid' });
      }

      if (path === '/api/config/flags' && method === 'GET') {
        const { results } = await env.CONFIG_DB.prepare(
          "SELECT key, value FROM app_config WHERE is_secret = 0 AND (key LIKE 'features.%' OR category = 'feature')"
        ).all<ConfigEntry>();
        const flags: Record<string, boolean> = {};
        for (const r of results) {
          flags[r.key.replace(/^features\./, '')] = r.value === 'true';
        }
        return json({ flags });
      }

      if (path === '/api/usage/record' && method === 'POST') {
        const body = await request.json() as { endpoint: string; method?: string; user_did?: string; status?: number; latency_ms?: number; cost_usdc?: string };
        const now = Date.now();
        await env.CONFIG_DB.prepare(
          "INSERT INTO api_usage (id, endpoint, method, user_did, status, timestamp, latency_ms, cost_usdc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          body.user_did ? `${body.endpoint}:${now}:${crypto.randomUUID()}` : crypto.randomUUID(),
          body.endpoint,
          body.method || 'GET',
          body.user_did || null,
          body.status ?? 200,
          now,
          body.latency_ms ?? null,
          body.cost_usdc ?? null
        ).run();
        return json({ recorded: true, timestamp: now });
      }

      if (path === '/api/usage' && method === 'GET') {
        const rangeDays = parseInt(url.searchParams.get('range') || '30');
        if (isNaN(rangeDays)) return json({ error: 'Invalid range' }, 400);
        const since = Date.now() - (rangeDays * 86400000);

        const totals = await env.CONFIG_DB.prepare(
          "SELECT COUNT(*) as calls, SUM(CAST(cost_usdc AS REAL)) as cost, AVG(latency_ms) as avg_latency FROM api_usage WHERE timestamp >= ?"
        ).bind(since).first<{ calls: number; cost: number | null; avg_latency: number | null }>();

        const byEndpoint = await env.CONFIG_DB.prepare(
          "SELECT endpoint, COUNT(*) as calls FROM api_usage WHERE timestamp >= ? GROUP BY endpoint ORDER BY calls DESC LIMIT 10"
        ).bind(since).all<{ endpoint: string; calls: number }>();

        const byDay = await env.CONFIG_DB.prepare(
          "SELECT CAST(timestamp / 86400000 AS INTEGER) as day, COUNT(*) as calls FROM api_usage WHERE timestamp >= ? GROUP BY day ORDER BY day"
        ).bind(since).all<{ day: number; calls: number }>();

        return json({
          range_days: rangeDays,
          total_calls: totals?.calls || 0,
          total_cost_usdc: String(totals?.cost || 0),
          avg_latency_ms: Math.round(totals?.avg_latency || 0),
          by_endpoint: byEndpoint.results || [],
          by_day: (byDay.results || []).map(r => ({ day: r.day, calls: r.calls })),
        });
      }

      // SLO source — availability + latency percentiles over a rolling window.
      if (path === '/api/usage/sli' && method === 'GET') {
        const minutes = parseInt(url.searchParams.get('minutes') || '1440');
        if (isNaN(minutes) || minutes <= 0) return json({ error: 'Invalid minutes' }, 400);
        const since = Date.now() - (minutes * 60000);

        const total = await env.CONFIG_DB.prepare(
          'SELECT COUNT(*) as n FROM api_usage WHERE timestamp >= ?'
        ).bind(since).first<{ n: number }>();
        const ok = await env.CONFIG_DB.prepare(
          'SELECT COUNT(*) as n FROM api_usage WHERE timestamp >= ? AND status < 500'
        ).bind(since).first<{ n: number }>();
        const latencies = await env.CONFIG_DB.prepare(
          'SELECT latency_ms FROM api_usage WHERE timestamp >= ? AND latency_ms IS NOT NULL'
        ).bind(since).all<{ latency_ms: number }>();

        const values = (latencies.results || []).map(r => r.latency_ms).sort((a, b) => a - b);
        const pct = (p: number): number | null => {
          if (!values.length) return null;
          const idx = Math.ceil((p / 100) * values.length) - 1;
          return values[Math.max(0, idx)];
        };

        const calls = total?.n || 0;
        const oks = ok?.n || 0;
        return json({
          window_minutes: minutes,
          total_calls: calls,
          ok_calls: oks,
          availability: calls ? oks / calls : null,
          p95_latency_ms: pct(95),
          p99_latency_ms: pct(99),
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
    }
  },
};
