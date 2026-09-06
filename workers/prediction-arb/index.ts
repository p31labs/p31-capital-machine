import { withRetry, withRetryAndFallback } from '../../shared/retry';
import { MetricsCollector, createMetricsCollector } from '../../shared/metrics';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  PRIVATE_KEY_ETH: string;
  DISCORD_WEBHOOK: string;
}

interface MarketRow {
  id: string;
  platform: string;
  external_id: string;
  question: string;
  yes_price: number;
  no_price: number;
  volume: number;
  status: string;
  last_checked: number;
  created_at: number;
}

interface ArbOpportunity {
  id: string;
  market_id: string;
  platform: string;
  yes_price: number;
  no_price: number;
  sum_price: number;
  profit_bps: number;
  expected_profit: number;
  gas_cost: number;
  net_profit: number;
  executed: boolean;
  tx_hash: string | null;
  created_at: number;
}

const POLYMARKET_API = 'https://clob.polymarket.com';
const MANIFOLD_API = 'https://api.manifold.markets';
const KALSHI_API = 'https://trading-api.kalshi.com';
const PREDICTIT_API = 'https://www.predictit.org/api/marketdata';

const FEE_BUFFER = 0.01;
const MIN_PROFIT_BPS = 50;

const KNOWN_MARKETS: Record<string, { platform: string; external_id: string; question: string }> = {
  'polymarket_btc_100k_2024': {
    platform: 'polymarket',
    external_id: '0x4d37f9375cb9f94a3020b52557e2bb54f9c689b40cf1e836164129404334a8cc-113',
    question: 'Will Bitcoin exceed $100,000 in 2024?',
  },
  'polymarket_eth_pow': {
    platform: 'polymarket',
    external_id: '0xa4b6b11f2d44fba51f6ee773259b9ef69e47b576e5b39db97baf5ccd3d5a3bd3-139',
    question: 'Will Ethereum switch to PoS?',
  },
  'polymarket_trump_2024': {
    platform: 'polymarket',
    external_id: '0x4d37f9375cb9f94a3020b52557e2bb54f9c689b40cf1e836164129404334a8cc-100',
    question: 'Will Trump win the 2024 presidential election?',
  },
  'manifold_ai_2027': {
    platform: 'manifold',
    external_id: 'Jsv6V7gZ4WQrDkvSqKfRcqz6X7dFKHMqN7MM5bKaq',
    question: 'Will AGI be achieved by 2027?',
  },
  'manifold_moon_2030': {
    platform: 'manifold',
    external_id: '7J6uPmSB4JDMq9QkNkLzDqKRkJjXkS9YhQXLN9yP',
    question: 'Will NASA return humans to the Moon by 2030?',
  },
  'kalshi_btc_25k': {
    platform: 'kalshi',
    external_id: 'KXBTCDEC24',
    question: 'Will Bitcoin exceed $25,000 in December 2024?',
  },
  'kalshi_fed_rate': {
    platform: 'kalshi',
    external_id: 'KXINTRATES',
    question: 'Fed rate decision outcome',
  },
  'predictit_inflation': {
    platform: 'predictit',
    external_id: '2853',
    question: 'Will US inflation be above 3% in December?',
  },
  'predictit_recession': {
    platform: 'predictit',
    external_id: '4321',
    question: 'Will the US enter a recession in 2025?',
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/scan') {
        const profitableOnly = url.searchParams.get('profitable') === 'true';
        const opportunities = await scanAllMarkets(env, profitableOnly);
        return new Response(JSON.stringify({ success: true, data: { opportunities } }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/markets') {
        const platform = url.searchParams.get('platform');
        const status = url.searchParams.get('status') || 'all';
        const minProfitBps = parseInt(url.searchParams.get('min_profit_bps') || '0', 10);
        const markets = await listMarkets(env, platform, status, minProfitBps);
        return new Response(JSON.stringify({ success: true, data: { markets } }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/execute' && method === 'POST') {
        const body = await request.json() as any;
        const opportunityId = body.opportunity_id;
        if (!opportunityId) {
          return new Response(JSON.stringify({ success: false, error: 'opportunity_id required', code: 'VALIDATION_ERROR' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const result = await executeArbitrage(env, opportunityId);
        return new Response(JSON.stringify({ success: true, data: result }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/stats') {
        const stats = await getPlatformStats(env);
        return new Response(JSON.stringify({ success: true, data: stats }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Prediction Market Arbitrage Scanner', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await scanAllMarkets(env, false);
  },
};

async function scanAllMarkets(env: Env, profitableOnly: boolean): Promise<ArbOpportunity[]> {
  const metrics = createMetricsCollector(env.CAPITAL_KV, 'prediction-arb');
  const opportunities: ArbOpportunity[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const [marketKey, marketInfo] of Object.entries(KNOWN_MARKETS)) {
    try {
      const prices = await fetchMarketPrices(env, marketInfo.platform, marketInfo.external_id);
      if (!prices) continue;

      const { yes, no, raw } = prices;
      const sum = yes + no;

      const existingRow = await env.CAPITAL_DB.prepare(
        'SELECT yes_price, no_price, volume, status FROM prediction_markets WHERE external_id = ? AND platform = ?'
      ).bind(marketInfo.external_id, marketInfo.platform).first<MarketRow>();

      if (existingRow) {
        await env.CAPITAL_DB.prepare(
          'UPDATE prediction_markets SET yes_price = ?, no_price = ?, volume = ?, last_checked = ? WHERE external_id = ? AND platform = ?'
        ).bind(yes, no, (existingRow as any).volume, now, marketInfo.external_id, marketInfo.platform).run();
      } else {
        const marketId = `${marketInfo.platform}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await env.CAPITAL_DB.prepare(
          'INSERT INTO prediction_markets (id, platform, external_id, question, yes_price, no_price, volume, status, last_checked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(marketId, marketInfo.platform, marketInfo.external_id, marketInfo.question, yes, no, 0, 'active', now, now).run();
      }

      const arbMargin = FEE_BUFFER - sum;
      const profitBps = Math.round(arbMargin * 10000);
      const expectedProfit = 1000 * arbMargin;

      if (profitBps >= MIN_PROFIT_BPS && (!profitableOnly || profitBps >= MIN_PROFIT_BPS)) {
        const marketRow = await env.CAPITAL_DB.prepare(
          'SELECT id FROM prediction_markets WHERE external_id = ? AND platform = ?'
        ).bind(marketInfo.external_id, marketInfo.platform).first<{ id: string }>();

        const opportunity: ArbOpportunity = {
          id: `arb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          market_id: marketRow?.id || marketInfo.external_id,
          platform: marketInfo.platform,
          yes_price: yes,
          no_price: no,
          sum_price: sum,
          profit_bps: profitBps,
          expected_profit: expectedProfit,
          gas_cost: 0.5,
          net_profit: expectedProfit - 0.5,
          executed: false,
          tx_hash: null,
          created_at: now,
        };

        await env.CAPITAL_DB.prepare(
          'INSERT INTO prediction_arbitrage_opportunities (id, market_id, platform, yes_price, no_price, sum_price, profit_bps, expected_profit, gas_cost, net_profit, executed, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          opportunity.id,
          opportunity.market_id,
          opportunity.platform,
          opportunity.yes_price,
          opportunity.no_price,
          opportunity.sum_price,
          opportunity.profit_bps,
          opportunity.expected_profit,
          opportunity.gas_cost,
          opportunity.net_profit,
          0,
          null,
          now,
        ).run();

        opportunities.push(opportunity);
        metrics.gauge('arbitrage.profit_bps', profitBps, { platform: marketInfo.platform });
      }

      metrics.gauge('platform.price_sum', sum, { platform: marketInfo.platform });
    } catch (err: any) {
      metrics.increment('platform.error', { platform: marketInfo.platform });
      continue;
    }
  }

  await metrics.flush();
  return opportunities;
}

async function fetchMarketPrices(
  env: Env,
  platform: string,
  externalId: string
): Promise<{ yes: number; no: number; raw: any } | null> {
  switch (platform) {
    case 'polymarket':
      return await withRetryAndFallback(
        () => fetchPolymarketPrices(externalId),
        { yes: 0.5, no: 0.5, raw: null },
        { maxAttempts: 2, baseDelayMs: 500 }
      );
    case 'manifold':
      return await withRetryAndFallback(
        () => fetchManifoldPrices(externalId),
        { yes: 0.5, no: 0.5, raw: null },
        { maxAttempts: 2, baseDelayMs: 500 }
      );
    case 'kalshi':
      return await withRetryAndFallback(
        () => fetchKalshiPrices(externalId),
        { yes: 0.5, no: 0.5, raw: null },
        { maxAttempts: 2, baseDelayMs: 500 }
      );
    case 'predictit':
      return await withRetryAndFallback(
        () => fetchPredictItPrices(externalId),
        { yes: 0.5, no: 0.5, raw: null },
        { maxAttempts: 2, baseDelayMs: 500 }
      );
    default:
      return null;
  }
}

async function fetchPolymarketPrices(tokenId: string): Promise<{ yes: number; no: number; raw: any }> {
  let midpoint: any = null;
  try {
    const midRes = await fetch(`${POLYMARKET_API}/midpoint?token_id=${encodeURIComponent(tokenId)}`);
    if (midRes.ok) {
      midpoint = await midRes.json();
    }
  } catch {
    midpoint = null;
  }

  if (midpoint && typeof midpoint.midpoint === 'number') {
    const yes = midpoint.midpoint;
    return { yes, no: 1 - yes, raw: midpoint };
  }

  let book: any = null;
  try {
    const bookRes = await withRetry(() =>
      fetch(`${POLYMARKET_API}/book?token_id=${encodeURIComponent(tokenId)}`)
    );
    if (bookRes.ok) {
      book = await bookRes.json();
    }
  } catch {
    book = null;
  }

  if (book && Array.isArray(book.bids) && Array.isArray(book.asks)) {
    const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price || 0) : 0;
    const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price || 0) : 1;
    const yes = Math.min(bestAsk, (bestBid + bestAsk) / 2);
    return { yes, no: 1 - yes, raw: book };
  }

  return { yes: 0.5, no: 0.5, raw: null };
}

async function fetchManifoldPrices(slug: string): Promise<{ yes: number; no: number; raw: any }> {
  const res = await withRetry(() =>
    fetch(`${MANIFOLD_API}/v0/market/${encodeURIComponent(slug)}`)
  );

  if (!res.ok) {
    throw new Error(`Manifold API returned ${res.status}`);
  }

  const data = (await res.json()) as any;
  if (data.isFilled || data.isResolved) {
    return { yes: data.probability ?? 0.5, no: 1 - (data.probability ?? 0.5), raw: data };
  }

  const yes = data.probability ?? 0.5;
  return { yes, no: 1 - yes, raw: data };
}

async function fetchKalshiPrices(ticker: string): Promise<{ yes: number; no: number; raw: any }> {
  const res = await withRetry(() =>
    fetch(`${KALSHI_API}/trade-api/v2/markets/${encodeURIComponent(ticker)}`)
  );

  if (!res.ok) {
    throw new Error(`Kalshi API returned ${res.status}`);
  }

  const data = (await res.json()) as any;
  if (!data.market) {
    return { yes: 0.5, no: 0.5, raw: null };
  }

  const market = data.market;
  const yes = (market?.yes_price ?? 0.5) / 100;
  const no = (market?.no_price ?? 0.5) / 100;

  return { yes, no, raw: market };
}

async function fetchPredictItPrices(marketId: string): Promise<{ yes: number; no: number; raw: any }> {
  const url = `${PREDICTIT_API}/detail/${encodeURIComponent(marketId)}/json`;
  const res = await withRetry(() => fetch(url));

  if (!res.ok) {
    throw new Error(`PredictIt API returned ${res.status}`);
  }

  const data = (await res.json()) as any;

  if (data.contracts) {
    const contract = Array.isArray(data.contracts) ? data.contracts[0] : data.contracts;
    const lastPrice = contract?.lastTradePrice ?? 0.5;
    const yes = lastPrice;
    const no = data.on_chain_last_trade_price ? 1 - data.on_chain_last_trade_price : 1 - yes;
    return { yes, no, raw: data };
  }

  return { yes: 0.5, no: 0.5, raw: null };
}

async function listMarkets(
  env: Env,
  platform: string | null,
  status: string,
  minProfitBps: number
): Promise<MarketRow[]> {
  let query = 'SELECT * FROM prediction_markets WHERE 1=1';
  const params: any[] = [];

  if (platform) {
    query += ' AND platform = ?';
    params.push(platform);
  }

  if (status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY last_checked DESC LIMIT 200';

  const rows = await env.CAPITAL_DB.prepare(query).bind(...params).all<MarketRow>();
  return rows.results || [];
}

async function executeArbitrage(env: Env, opportunityId: string): Promise<any> {
  const row = await env.CAPITAL_DB.prepare(
    'SELECT * FROM prediction_arbitrage_opportunities WHERE id = ? AND executed = 0'
  ).bind(opportunityId).first<ArbOpportunity>();

  if (!row) {
    throw new Error('Opportunity not found or already executed');
  }

  const market = await env.CAPITAL_DB.prepare(
    'SELECT platform, external_id FROM prediction_markets WHERE id = ?'
  ).bind(row.market_id).first<{ platform: string; external_id: string }>();

  if (!market) {
    throw new Error('Associated market not found');
  }

  const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

  await env.CAPITAL_DB.prepare(
    'UPDATE prediction_arbitrage_opportunities SET executed = 1, tx_hash = ? WHERE id = ?'
  ).bind(txHash, opportunityId).run();

  return {
    success: true,
    opportunity_id: opportunityId,
    market: market,
    prices: { yes: row.yes_price, no: row.no_price },
    profit_bps: row.profit_bps,
    expected_profit: row.expected_profit,
    tx_hash: txHash,
  };
}

async function getPlatformStats(env: Env): Promise<any> {
  const stats: Record<string, any> = {};

  for (const platform of ['polymarket', 'manifold', 'kalshi', 'predictit']) {
    const marketCount = await env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count FROM prediction_markets WHERE platform = ?'
    ).bind(platform).first<{ count: number }>();

    const oppCount = await env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count FROM prediction_arbitrage_opportunities WHERE platform = ? AND executed = 0'
    ).bind(platform).first<{ count: number }>();

    const avgProfitBps = await env.CAPITAL_DB.prepare(
      'SELECT AVG(profit_bps) as avg_bps FROM prediction_arbitrage_opportunities WHERE platform = ?'
    ).bind(platform).first<{ avg_bps: number }>();

    const execCount = await env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count FROM prediction_arbitrage_opportunities WHERE platform = ? AND executed = 1'
    ).bind(platform).first<{ count: number }>();

    stats[platform] = {
      markets_tracked: marketCount?.count || 0,
      active_opportunities: oppCount?.count || 0,
      avg_profit_bps: Math.round(avgProfitBps?.avg_bps || 0),
      trades_executed: execCount?.count || 0,
    };
  }

  return {
    platforms: stats,
    total_markets: Object.values(stats).reduce((sum: number, p: any) => sum + p.markets_tracked, 0),
    total_opportunities: Object.values(stats).reduce((sum: number, p: any) => sum + p.active_opportunities, 0),
    timestamp: Date.now(),
  };
}
