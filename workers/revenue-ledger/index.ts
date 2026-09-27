import { createLogger } from '../../shared/logger';
import { startSpan, recordMetric, configureFromEnv } from '../observability/otel';
import { RevenueLedger } from './ledger';
import { AuditTrail } from './audit';

export interface Env {
  REVENUE_DB: D1Database;
  ENVIRONMENT: string;
  GUMLOCK_PRODUCT_IDS?: string;
  GUMLOCK_PRODUCTS?: string;
  GUMLOCK_MERCHANT?: string;
}

const GUMLOCK_MERCHANT_DEFAULT = 'gumroad:willow680';

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export interface RecordRevenueRequest {
  source: 'x402' | 'taler' | 'gumroad' | 'btcpay' | 'love' | 'arcade';
  payer_did: string;
  merchant_did: string;
  amount_usdc: string;
  asset: 'USDC' | 'EUR' | 'LOVE';
  amount_love?: string;
  tx_hash?: string;
  metadata?: Record<string, any>;
  settlement_tx?: string;
}

export interface RevenueSummary {
  total_usdc: string;
  total_eur: string;
  total_love: string;
  total_x402: string;
  count: number;
  avg_per_transaction: string;
  source_breakdown: Record<string, { count: number; total_usdc: string }>;
}

export interface BalanceResult {
  did: string;
  total_earned_usdc: string;
  total_earned_eur: string;
  total_earned_love: string;
  transaction_count: number;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configureFromEnv(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const logger = createLogger('revenue-ledger', env.ENVIRONMENT);
    const ledger = new RevenueLedger(env.REVENUE_DB, logger);
    const audit = new AuditTrail(env.REVENUE_DB);
    await ledger.ensureSchema();

    try {
      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'revenue-ledger',
          timestamp: Date.now(),
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      if (path === '/metrics' && method === 'GET') {
        const totals = await env.REVENUE_DB.prepare(`
          SELECT
            SUM(CASE WHEN asset = 'USDC' OR source IN ('x402', 'btcpay', 'gumroad') THEN CAST(amount_usdc AS REAL) ELSE 0 END) as total_usdc,
            SUM(CASE WHEN asset = 'EUR' OR source = 'taler' THEN CAST(amount_usdc AS REAL) ELSE 0 END) as total_eur,
            SUM(CASE WHEN asset = 'LOVE' OR source = 'love' THEN CAST(amount_usdc AS REAL) ELSE 0 END) as total_love,
            COUNT(*) as count,
            MAX(created_at) as last_updated
          FROM revenue_events
        `).first<{ total_usdc: number | null; total_eur: number | null; total_love: number | null; count: number; last_updated: number | null }>();

        const verification = await ledger.verifyHashChain();

        return new Response(JSON.stringify({
          revenue_total_usdc: String(totals?.total_usdc || 0),
          revenue_total_eur: String(totals?.total_eur || 0),
          revenue_total_love: String(totals?.total_love || 0),
          transaction_count: totals?.count || 0,
          hash_chain_valid: verification.valid,
          last_updated: totals?.last_updated ? new Date(totals.last_updated).toISOString() : new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/revenue/record' && method === 'POST') {
        const body = await request.json() as RecordRevenueRequest;
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'revenue.record',
          attributes: { source: body.source, amount: body.amount_usdc },
        });
        try {
          const result = await ledger.recordRevenue(body);
          await audit.logEvent('revenue_recorded', { id: result.id, source: body.source });
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path === '/revenue/summary' && method === 'GET') {
        const source = url.searchParams.get('source') as string | null;
        const range = url.searchParams.get('range') || '30d';
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'revenue.summary',
          attributes: { source_filter: source || 'all', range },
        });
        try {
          const summary = await ledger.getRevenueSummary(source, range);
          return new Response(JSON.stringify(summary), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path.startsWith('/revenue/balance/') && method === 'GET') {
        const did = decodeURIComponent(path.replace('/revenue/balance/', ''));
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'revenue.balance',
          attributes: { did },
        });
        try {
          const balance = await ledger.getBalance(did);
          if (!balance) {
            return new Response(JSON.stringify({ error: 'DID not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          return new Response(JSON.stringify(balance), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path === '/revenue/ledger' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'revenue.ledger',
          attributes: { limit, offset },
        });
        try {
          const { entries } = await ledger.getLedgerEntries(limit, offset, null);
          return new Response(JSON.stringify({ entries }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path === '/webhook/x402' && method === 'POST') {
        const body = await request.json() as Record<string, any>;
        const settlement = await ledger.recordRevenue({
          source: 'x402',
          payer_did: body.payer_did || body.requester || 'unknown',
          merchant_did: body.merchant_did || 'cloudflare-gateway',
          amount_usdc: body.amount_usdc || body.amount || '0',
          asset: body.asset || 'USDC',
          amount_love: body.amount_love,
          tx_hash: body.tx_hash || body.settlement_tx,
          metadata: body.metadata || { gateway: 'cloudflare-monetization' },
          settlement_tx: body.settlement_tx || body.tx_hash,
        });
        await audit.record({
          event_type: 'x402_settlement',
          actor_did: body.payer_did || 'system',
          action: 'settlement_received',
          target: settlement.id,
          metadata: { amount: body.amount_usdc },
        });
        return new Response(JSON.stringify({ received: true, settlement }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/webhook/gumroad' && method === 'POST') {
        const contentType = request.headers.get('content-type') || '';
        let raw = await request.text();
        let body: Record<string, any> = {};
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const sp = new URLSearchParams(raw);
          for (const [k, v] of sp.entries()) body[k] = v;
        } else {
          try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
        }
        const resourceName: string = String(body.resource_name || 'sale').toLowerCase();
        const saleId: string = String(body.sale_id || body.id || body.permalink || '');
        const productId: string = String(body.product_id || '').toLowerCase();
        const permalink: string = String(body.product_permalink || '').toLowerCase();
        const idAllowlist = parseList(env.GUMLOCK_PRODUCT_IDS);
        const permAllowlist = parseList(env.GUMLOCK_PRODUCTS);
        const allowlistConfigured = idAllowlist.length > 0 || permAllowlist.length > 0;

        if (!saleId) {
          return new Response(JSON.stringify({ error: 'missing sale_id' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        if (resourceName !== 'sale') {
          return new Response(JSON.stringify({ received: true, resource_name: resourceName, recorded: false }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const allowed =
          (idAllowlist.length > 0 && idAllowlist.includes(productId)) ||
          (permAllowlist.length > 0 && permAllowlist.includes(permalink));

        if (allowlistConfigured && !allowed) {
          return new Response(JSON.stringify({ error: 'product not in allowlist', product_id: productId, permalink }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        if (!allowlistConfigured || !allowed) {
          return new Response(JSON.stringify({ error: 'no allowlist configured; sale rejected', product_id: productId, permalink }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const existing = await env.REVENUE_DB.prepare(
          'SELECT id FROM revenue_events WHERE settlement_tx = ? AND source = ?'
        ).bind(String(saleId), 'gumroad').first<{ id: string }>();

        if (existing) {
          return new Response(JSON.stringify({ received: true, duplicate: true, id: existing.id }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const cents = parseInt(String(body.amount ?? '0'), 10);
        const amountUsdc = Number.isFinite(cents) ? String((cents / 100).toFixed(2)) : '0';

        const merchant = env.GUMLOCK_MERCHANT || GUMLOCK_MERCHANT_DEFAULT;
        const payer = String(body.email || body.customer_id || body.purchaser_email || 'gumroad-anon');

        const result = await ledger.recordRevenue({
          source: 'gumroad',
          payer_did: payer,
          merchant_did: merchant,
          amount_usdc: amountUsdc,
          asset: 'USDC',
          tx_hash: String(saleId),
          settlement_tx: String(saleId),
          metadata: {
            permalink,
            product_name: body.product_name || body.product || '',
            order_id: body.order_id || '',
            currency: body.currency || 'usd',
            cents,
          },
        });

        await audit.record({
          event_type: 'gumroad_sale',
          actor_did: payer,
          action: 'sale_received',
          target: result.id,
          metadata: { sale_id: saleId, permalink, amount_usd: amountUsdc },
        });

        return new Response(JSON.stringify({ received: true, duplicate: false, ...result }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/revenue/verify-chain' && method === 'GET') {
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'revenue.verify_chain',
        });
        try {
          const verification = await ledger.verifyHashChain();
          return new Response(JSON.stringify(verification), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path === '/reconciliation' && method === 'GET') {
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'reconciliation',
        });
        try {
          const result = await ledger.reconcile();
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path.startsWith('/audit/events') && method === 'GET') {
        const eventType = url.searchParams.get('event_type') || '';
        const actorDid = url.searchParams.get('actor_did') || '';
        const since = url.searchParams.get('since') || '';
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'audit.events',
          attributes: { event_type: eventType, actor_did: actorDid, since, limit },
        });
        try {
          const events = await audit.getEvents(eventType, actorDid, since, limit);
          return new Response(JSON.stringify({ events }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (path === '/audit/verify' && method === 'GET') {
        const span = await startSpan({
          service: 'revenue-ledger',
          operation: 'audit.verify',
        });
        try {
          const result = await audit.verifyIntegrity();
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      return new Response('Revenue Ledger', { status: 200 });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
