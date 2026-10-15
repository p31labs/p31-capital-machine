import { createLogger } from '../../shared/logger';
import { startSpan, recordMetric, configureFromEnv } from '../observability/otel';
import { respond } from '../../shared/response';
import { EntitlementService } from './service';
import {
  getX402,
  buildRequirements,
  buildResourceInfo,
  paymentRequiredResponse,
  paymentSettlementFailedResponse,
  parsePaymentPayload,
  serializeSettleResponse,
  type X402Env,
  type PaymentRequiredBody,
  type PaymentPayload,
  type SettleResponse,
} from './x402';

export interface Env {
  ENTITLEMENT_DB: D1Database;
  ENVIRONMENT: string;
  X402_FACILITATOR?: string;
  X402_NETWORK?: string;
  X402_PAY_TO?: string;
  X402_ASSET?: string;
  X402_SELF_HOSTED_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  /** CORS allowlist (comma-separated origins). Unset = legacy wildcard. */
  ALLOWED_ORIGINS?: string;
}

export interface CheckRequest {
  did: string;
  tool_id: string;
  estimated_cost_usdc: string;
}

export interface ConsumeRequest {
  did: string;
  tool_id: string;
  amount_usdc: string;
  tx_hash: string;
}

export interface TierSetRequest {
  did: string;
  tier: string;
}

export interface LoveIssueRequest {
  did: string;
  amount: string;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-PAYMENT',
    'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
  };
  if (allowed.length > 0) {
    if (origin && allowed.includes(origin)) {
      return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', ...base };
    }
    return {};
  }
  return { 'Access-Control-Allow-Origin': '*', ...base };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configureFromEnv(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const logger = createLogger('entitlement', env.ENVIRONMENT);
    const service = new EntitlementService(env.ENTITLEMENT_DB, env);

    try {
      if (path === '/health' && method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'entitlement',
            timestamp: Date.now(),
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
          }
        );
      }

      if (path === '/metrics' && method === 'GET') {
        const userCount = await env.ENTITLEMENT_DB.prepare('SELECT COUNT(*) as total FROM entitlements').first<{ total: number }>();
        const tierRows = await env.ENTITLEMENT_DB.prepare('SELECT tier, COUNT(*) as count FROM entitlements GROUP BY tier').all<{ tier: string; count: number }>();
        const balanceResult = await env.ENTITLEMENT_DB.prepare("SELECT SUM(CAST(balance_usdc AS REAL)) as total FROM entitlements").first<{ total: number | null }>();
        const usageResult = await env.ENTITLEMENT_DB.prepare("SELECT SUM(CAST(monthly_used_usdc AS REAL)) as used, SUM(CAST(monthly_allowance_usdc AS REAL)) as allowance FROM entitlements").first<{ used: number | null; allowance: number | null }>();

        const tier_distribution: Record<string, number> = {};
        for (const row of tierRows.results || []) {
          tier_distribution[row.tier] = row.count;
        }

        const used = usageResult?.used || 0;
        const allowance = usageResult?.allowance || 0;
        const monthly_allowance_used_pct = allowance > 0 ? parseFloat(((used / allowance) * 100).toFixed(1)) : 0;

        const now = new Date();
        const lastReset = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        return new Response(JSON.stringify({
          total_users: userCount?.total || 0,
          tier_distribution,
          total_balance_usdc: String(balanceResult?.total || 0),
          monthly_allowance_used_pct,
          last_reset: lastReset,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
        });
      }

      if (path.startsWith('/entitlement/') && method === 'GET') {
        const did = decodeURIComponent(path.replace('/entitlement/', ''));

        const x402 = await getX402(env, (msg) => logger.info(msg, {}));

        const paymentHeader = request.headers.get('X-PAYMENT');

        if (!paymentHeader) {
          const requirement = await buildRequirements(x402);
          const resourceInfo = buildResourceInfo(request.url, did);
          const pr = await x402.server.createPaymentRequiredResponse([requirement], resourceInfo, 'Payment required');
          logger.info('x402 paywall: issued 402', {
            did,
            network: x402.network,
            asset: requirement.asset,
            amount: requirement.amount,
            facilitator: x402.mode,
          });
          return paymentRequiredResponse(pr as PaymentRequiredBody);
        }

        let paymentPayload: PaymentPayload;
        try {
          paymentPayload = parsePaymentPayload(paymentHeader);
        } catch {
          const requirement = await buildRequirements(x402);
          const resourceInfo = buildResourceInfo(request.url, did);
          const pr = await x402.server.createPaymentRequiredResponse(
            [requirement],
            resourceInfo,
            'Invalid X-PAYMENT payload (must be base64 JSON)'
          );
          return paymentRequiredResponse(pr as PaymentRequiredBody);
        }

        const requirement = await buildRequirements(x402);
        const matched = x402.server.findMatchingRequirements([requirement], paymentPayload);

        if (!matched) {
          const resourceInfo = buildResourceInfo(request.url, did);
          const pr = await x402.server.createPaymentRequiredResponse(
            [requirement],
            resourceInfo,
            'Payment does not match any accepted requirement'
          );
          return paymentRequiredResponse(pr as PaymentRequiredBody);
        }

        let verifyResult;
        try {
          verifyResult = await x402.server.verifyPayment(paymentPayload, matched);
        } catch (error: any) {
          logger.error('x402 verify raised', error, { did, network: x402.network });
          const resourceInfo = buildResourceInfo(request.url, did);
          const pr = await x402.server.createPaymentRequiredResponse(
            [requirement],
            resourceInfo,
            `Payment verification unavailable: ${error?.message || String(error)}`
          );
          return paymentRequiredResponse(pr as PaymentRequiredBody);
        }

        if (!verifyResult.isValid) {
          const resourceInfo = buildResourceInfo(request.url, did);
          const pr = await x402.server.createPaymentRequiredResponse(
            [requirement],
            resourceInfo,
            `Payment verification failed: ${verifyResult.invalidReason || verifyResult.invalidMessage || 'invalid'}`
          );
          return paymentRequiredResponse(pr as PaymentRequiredBody);
        }

        const entitlement = await service.getEntitlement(did);

        if (!entitlement) {
          return respond.notFound('DID not found');
        }

        const tierLimits = await service.getTierLimits(entitlement.tier);
        const monthlyRemaining = service['subtractStrings'](tierLimits.monthly_allowance_usdc, entitlement.monthly_used_usdc);
        const usage = await service.getUsage(did, 'all');

        const responseBody = {
          balance_usdc: entitlement.balance_usdc,
          balance_love: entitlement.balance_love,
          tier: entitlement.tier,
          monthly_remaining: monthlyRemaining,
          usage,
        };

        let settleResponse: SettleResponse;
        try {
          settleResponse = (await x402.server.settlePayment(paymentPayload, matched)) as SettleResponse;
        } catch (error: any) {
          logger.error('x402 settlement failed after handler ran', error, { did, network: x402.network });
          recordMetric('entitlement.x402_settle_failure', 1, { did, facilitator: x402.mode });
          return paymentSettlementFailedResponse(error?.message || String(error));
        }

        if (!settleResponse.success) {
          logger.error('x402 settlement reported failure after handler ran', undefined, { did, settle: settleResponse });
          recordMetric('entitlement.x402_settle_failure', 1, { did, facilitator: x402.mode });
          return paymentSettlementFailedResponse(settleResponse.errorReason || settleResponse.errorMessage || 'settle failed');
        }

        recordMetric('entitlement.x402_paid', 1, { did, facilitator: x402.mode, payer: settleResponse.payer || 'unknown' });

        return new Response(JSON.stringify({ success: true, data: responseBody, timestamp: Date.now() }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-PAYMENT-RESPONSE': serializeSettleResponse(settleResponse),
            ...corsHeaders(request, env),
          },
        });
      }

      if (path === '/entitlement/check' && method === 'POST') {
        const body = await request.json() as CheckRequest;

        if (!body.did || !body.tool_id || !body.estimated_cost_usdc) {
          return respond.badRequest('Missing required fields: did, tool_id, estimated_cost_usdc');
        }

        const span = await startSpan({
          service: 'entitlement',
          operation: 'entitlement.check',
          attributes: { did: body.did, tool_id: body.tool_id },
        });
        try {
          const result = await service.checkEntitlement(body.did, body.tool_id, body.estimated_cost_usdc);
          recordMetric('entitlement.check', result.ok ? 1 : 0, { did: body.did, tool_id: body.tool_id, result: result.ok ? 'pass' : 'fail' });
          if (!result.ok) {
            return new Response(JSON.stringify(result), {
              status: 402,
              headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
            });
          }
          return respond.ok(result);
        } finally {
          span.end();
        }
      }

      if (path === '/entitlement/consume' && method === 'POST') {
        const body = await request.json() as ConsumeRequest;

        if (!body.did || !body.tool_id || !body.amount_usdc || !body.tx_hash) {
          return respond.badRequest('Missing required fields: did, tool_id, amount_usdc, tx_hash');
        }

        const existing = await env.ENTITLEMENT_DB.prepare('SELECT * FROM consume_tx_log WHERE tx_hash = ?').bind(body.tx_hash).first<any>();
        const idempotent = !!existing;

        const span = await startSpan({
          service: 'entitlement',
          operation: 'entitlement.consume',
          attributes: { did: body.did, tool_id: body.tool_id, amount: body.amount_usdc, idempotent: idempotent ? 1 : 0 },
        });
        try {
          const result = await service.consumeEntitlement(body.did, body.tool_id, body.amount_usdc, body.tx_hash);
          recordMetric('entitlement.consume', parseFloat(body.amount_usdc), { did: body.did, tool_id: body.tool_id, idempotent: String(idempotent) });
          return respond.ok(result);
        } finally {
          span.end();
        }
      }

      if (path === '/entitlement/tier-set' && method === 'POST') {
        const body = await request.json() as TierSetRequest;

        if (!body.did || !body.tier) {
          return respond.badRequest('Missing required fields: did, tier');
        }

        const span = await startSpan({
          service: 'entitlement',
          operation: 'entitlement.set_tier',
          attributes: { did: body.did, tier: body.tier },
        });
        try {
          const result = await service.setTier(body.did, body.tier);
          recordMetric('entitlement.tier_set', 1, { did: body.did, tier: body.tier });
          return respond.ok(result);
        } finally {
          span.end();
        }
      }

      if (path === '/love/issue' && method === 'POST') {
        const body = await request.json() as LoveIssueRequest;

        if (!body.did || !body.amount) {
          return respond.badRequest('Missing required fields: did, amount');
        }

        const span = await startSpan({
          service: 'entitlement',
          operation: 'love.issue',
          attributes: { did: body.did, amount: body.amount },
        });
        try {
          const result = await service.issueLOVE(body.did, body.amount);
          recordMetric('love.issue', parseFloat(body.amount), { did: body.did });
          return respond.ok(result);
        } finally {
          span.end();
        }
      }

      return new Response(
        JSON.stringify({
          error: 'Not found',
          available: [
            'GET /entitlement/{did}',
            'POST /entitlement/check',
            'POST /entitlement/consume',
            'POST /entitlement/tier-set',
            'POST /love/issue',
            'GET /health',
            'GET /metrics',
          ],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
        }
      );
    } catch (error: any) {
      logger.error('Request failed', error, { path, method });
      return new Response(
        JSON.stringify({
          error: error.message,
          ...(env.ENVIRONMENT === 'development' && { stack: error.stack }),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
        }
      );
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const logger = createLogger('entitlement', env.ENVIRONMENT);
    const service = new EntitlementService(env.ENTITLEMENT_DB, env);

    try {
      if (event.cron === '0 0 1 * *') {
        const span = await startSpan({
          service: 'entitlement',
          operation: 'entitlement.monthly_reset',
        });
        try {
          await logger.timed('monthly_entitlement_reset', async () => {
            const result = await service.resetMonthlyUsage();
            recordMetric('entitlement.monthly_reset', result.rowsUpdated, {});
            logger.info('Monthly entitlement reset complete', {
              rows_updated: result.rowsUpdated,
            });
          });
        } finally {
          span.end();
        }
      }
    } catch (error: any) {
      logger.error('Scheduled task failed', error, { cron: event.cron });
    }
  },
};
