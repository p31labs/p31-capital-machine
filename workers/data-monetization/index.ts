export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  JWT_SECRET: string;
  DISCORD_WEBHOOK: string;
}

interface ApiKey {
  id: string;
  name: string;
  key_hash: string;
  tier: string;
  rate_limit: number;
  monthly_quota: number;
  requests_this_month: number;
  active: boolean;
}

const API_TIERS = {
  free: { rate_limit: 10, monthly_quota: 1000, price: 0 },
  pro: { rate_limit: 60, monthly_quota: 10000, price: 49 },
  enterprise: { rate_limit: 300, monthly_quota: 100000, price: 499 },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API key authentication for data endpoints
      const apiKey = request.headers.get('X-API-Key');
      let keyData: ApiKey | null = null;

      if (path.startsWith('/v1/')) {
        if (!apiKey) {
          return new Response(JSON.stringify({ error: 'Missing X-API-Key header' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        keyData = await authenticateKey(env, apiKey);
        if (!keyData) {
          return new Response(JSON.stringify({ error: 'Invalid API key' }), {
            status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (keyData.requests_this_month >= keyData.monthly_quota) {
          return new Response(JSON.stringify({ error: 'Monthly quota exceeded' }), {
            status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // Admin endpoints
      if (path === '/admin/keys') {
        const keys = await env.CAPITAL_DB.prepare('SELECT id, name, tier, rate_limit, requests_this_month, active, created_at FROM data_api_keys').all();
        return new Response(JSON.stringify({ keys: keys.results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/admin/key' && method === 'POST') {
        const body = await request.json() as any;
        const result = await createApiKey(env, body);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Data API endpoints
      if (path === '/v1/leads') {
        const source = url.searchParams.get('source');
        const minScore = parseInt(url.searchParams.get('min_score') || '0');
        const limit = parseInt(url.searchParams.get('limit') || '50');

        let query = 'SELECT * FROM leads WHERE score >= ?';
        const params: any[] = [minScore];
        if (source) { query += ' AND source = ?'; params.push(source); }
        query += ' ORDER BY score DESC LIMIT ?';
        params.push(limit);

        const start = Date.now();
        const leads = await env.CAPITAL_DB.prepare(query).bind(...params).all();
        await trackQuery(env, keyData!, '/v1/leads', start);

        return new Response(JSON.stringify({ data: leads.results, count: leads.results?.length }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/v1/campaigns') {
        const status = url.searchParams.get('status') || 'active';
        const limit = parseInt(url.searchParams.get('limit') || '50');

        const start = Date.now();
        const campaigns = await env.CAPITAL_DB.prepare(
          'SELECT * FROM campaigns WHERE status = ? ORDER BY raised DESC LIMIT ?'
        ).bind(status, limit).all();
        await trackQuery(env, keyData!, '/v1/campaigns', start);

        return new Response(JSON.stringify({ data: campaigns.results, count: campaigns.results?.length }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/v1/opportunities') {
        const minProfit = parseInt(url.searchParams.get('min_profit_bps') || '100');
        const limit = parseInt(url.searchParams.get('limit') || '50');

        const start = Date.now();
        const opportunities = await env.CAPITAL_DB.prepare(
          'SELECT * FROM arbitrage_opportunities WHERE profit_bps >= ? ORDER BY profit_bps DESC LIMIT ?'
        ).bind(minProfit, limit).all();
        await trackQuery(env, keyData!, '/v1/opportunities', start);

        return new Response(JSON.stringify({ data: opportunities.results, count: opportunities.results?.length }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/v1/stats') {
        const start = Date.now();
        const stats = await getAggregatedStats(env);
        await trackQuery(env, keyData!, '/v1/stats', start);

        return new Response(JSON.stringify({ data: stats }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/v1/feed') {
        const feedType = url.searchParams.get('type') || 'leads';
        const start = Date.now();
        const feed = await getFeed(env, feedType);
        await trackQuery(env, keyData!, '/v1/feed', start);

        return new Response(JSON.stringify({ data: feed }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Public endpoints
      if (path === '/pricing') {
        return new Response(JSON.stringify({ tiers: API_TIERS }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/docs') {
        return new Response(JSON.stringify({
          api: 'P31 Capital Machine Data API',
          version: '1.0',
          endpoints: {
            '/v1/leads': { method: 'GET', params: 'source, min_score, limit', auth: 'X-API-Key' },
            '/v1/campaigns': { method: 'GET', params: 'status, limit', auth: 'X-API-Key' },
            '/v1/opportunities': { method: 'GET', params: 'min_profit_bps, limit', auth: 'X-API-Key' },
            '/v1/stats': { method: 'GET', auth: 'X-API-Key' },
            '/v1/feed': { method: 'GET', params: 'type', auth: 'X-API-Key' },
            '/admin/keys': { method: 'GET', auth: 'Admin' },
            '/admin/key': { method: 'POST', auth: 'Admin' },
            '/pricing': { method: 'GET' },
          },
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      return new Response('Data Monetization API', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // Monthly: reset API key quotas
    const now = new Date();
    if (now.getDate() === 1) {
      await env.CAPITAL_DB.prepare(
        'UPDATE data_api_keys SET requests_this_month = 0'
      ).run();
    }
  },
};

async function authenticateKey(env: Env, key: string): Promise<ApiKey | null> {
  const keyHash = await hashKey(key);
  const result = await env.CAPITAL_DB.prepare(
    'SELECT * FROM data_api_keys WHERE key_hash = ? AND active = 1'
  ).bind(keyHash).first();
  return result as ApiKey | null;
}

async function createApiKey(env: Env, data: any): Promise<any> {
  const id = crypto.randomUUID();
  const rawKey = `p31_${crypto.randomUUID().replace(/-/g, '')}_${data.name.replace(/\s+/g, '_').toLowerCase()}`;
  const keyHash = await hashKey(rawKey);

  const tier = data.tier || 'free';
  const tierConfig = API_TIERS[tier as keyof typeof API_TIERS] || API_TIERS.free;

  await env.CAPITAL_DB.prepare(
    `INSERT INTO data_api_keys (id, name, key_hash, tier, rate_limit, monthly_quota, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).bind(id, data.name, keyHash, tier, tierConfig.rate_limit, tierConfig.monthly_quota, Date.now()).run();

  return { id, name: data.name, key: rawKey, tier, rateLimit: tierConfig.rate_limit, monthlyQuota: tierConfig.monthly_quota };
}

async function trackQuery(env: Env, keyData: ApiKey, endpoint: string, startTime: number): Promise<void> {
  const duration = Date.now() - startTime;

  await env.CAPITAL_DB.prepare(
    `INSERT INTO data_queries (id, api_key_id, endpoint, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), keyData.id, endpoint, duration, Date.now()).run();

  await env.CAPITAL_DB.prepare(
    'UPDATE data_api_keys SET requests_this_month = requests_this_month + 1, last_used_at = ? WHERE id = ?'
  ).bind(Date.now(), keyData.id).run();
}

async function getAggregatedStats(env: Env): Promise<any> {
  const [leads, campaigns, opportunities] = await Promise.all([
    env.CAPITAL_DB.prepare('SELECT COUNT(*) as total, AVG(score) as avgScore, source FROM leads GROUP BY source').all(),
    env.CAPITAL_DB.prepare('SELECT status, COUNT(*) as count, SUM(goal) as totalGoal, SUM(raised) as totalRaised FROM campaigns GROUP BY status').all(),
    env.CAPITAL_DB.prepare('SELECT chain, COUNT(*) as count, MAX(profit_bps) as maxProfit FROM arbitrage_opportunities GROUP BY chain').all(),
  ]);

  return {
    leads: leads.results || [],
    campaigns: campaigns.results || [],
    opportunities: opportunities.results || [],
    generatedAt: Date.now(),
  };
}

async function getFeed(env: Env, type: string): Promise<any[]> {
  switch (type) {
    case 'leads':
      const leadsResult = await env.CAPITAL_DB.prepare(
        'SELECT * FROM leads WHERE score >= 50 ORDER BY score DESC LIMIT 100'
      ).all();
      return leadsResult.results || [];

    case 'campaigns':
      const campaignsResult = await env.CAPITAL_DB.prepare(
        "SELECT * FROM campaigns WHERE status = 'active' ORDER BY raised DESC LIMIT 100"
      ).all();
      return campaignsResult.results || [];

    case 'opportunities':
      const oppsResult = await env.CAPITAL_DB.prepare(
        'SELECT * FROM arbitrage_opportunities WHERE executed = 0 ORDER BY profit_bps DESC LIMIT 100'
      ).all();
      return oppsResult.results || [];

    default:
      return [];
  }
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
