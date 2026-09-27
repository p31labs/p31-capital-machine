import { createLogger } from '../../../shared/logger';
import { startSpan, recordMetric, configureFromEnv } from '../../observability/otel';
import { CapitalAllocator } from './service';
import type { AllocateRequest } from '../sdk/types';

export interface Env {
  ALLOCATOR_DB: D1Database;
  REVENUE_LEDGER_URL: string;
  ENVIRONMENT: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const logger = createLogger('capital-allocator');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configureFromEnv(env);
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const allocator = new CapitalAllocator(env.ALLOCATOR_DB, logger, env);

    try {
      if (url.pathname === '/metrics' && method === 'GET') {
        const totalResult = await env.ALLOCATOR_DB.prepare("SELECT SUM(CAST(amount_usdc AS REAL)) as total FROM allocations WHERE status != 'failed'").first<{ total: number | null }>();
        const pendingResult = await env.ALLOCATOR_DB.prepare("SELECT COUNT(*) as count FROM allocations WHERE status = 'pending'").first<{ count: number }>();
        const roiResult = await env.ALLOCATOR_DB.prepare(`
          SELECT a.target, AVG(ar.roi_bps) as avg_roi
          FROM allocation_results ar
          JOIN allocations a ON ar.allocation_id = a.id
          GROUP BY a.target
        `).all<{ target: string; avg_roi: number | null }>();
        const lastRebalanceResult = await env.ALLOCATOR_DB.prepare('SELECT MAX(next_rebalance_at) as last_rebalance FROM allocations').first<{ last_rebalance: number | null }>();

        const roi_by_target: Record<string, number> = {};
        for (const row of roiResult.results || []) {
          roi_by_target[row.target] = Math.round(row.avg_roi || 0);
        }

        return new Response(JSON.stringify({
          total_allocated_usdc: String(totalResult?.total || 0),
          roi_by_target,
          pending_allocations: pendingResult?.count || 0,
          last_rebalance: lastRebalanceResult?.last_rebalance ? new Date(lastRebalanceResult.last_rebalance).toISOString() : new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (url.pathname === '/allocate' && method === 'POST') {
        const body = await request.json() as AllocateRequest;
        const span = await startSpan({
          service: 'capital-allocator',
          operation: 'allocator.allocate',
          attributes: { source_tx_id: body.source_tx_id, target_count: body.targets.length },
        });
        try {
          const allocations = await allocator.allocate(body);
          recordMetric('allocator.allocate', allocations.length, { source_tx_id: body.source_tx_id });
          return new Response(JSON.stringify({ allocations }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (url.pathname === '/allocation/statuses') {
        const span = await startSpan({
          service: 'capital-allocator',
          operation: 'allocator.statuses',
        });
        try {
          const result = await env.ALLOCATOR_DB.prepare(
            'SELECT * FROM allocations ORDER BY created_at DESC LIMIT 100'
          ).all<{ id: string; target: string; amount_usdc: string; status: string; next_rebalance_at: number; created_at: number }>();
          const allocations = (result.results || []).map((a) => ({
            target: a.target,
            allocated: parseFloat(a.amount_usdc) || 0,
            roi_bps: 0,
            status: a.status,
            last_rebalance: a.next_rebalance_at ? new Date(a.next_rebalance_at).toISOString() : '',
          }));
          return new Response(JSON.stringify({ allocations }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (url.pathname === '/allocation/status') {
        const target = url.searchParams.get('target');
        if (!target) {
          return new Response(JSON.stringify({ error: 'target query param required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const span = await startSpan({
          service: 'capital-allocator',
          operation: 'allocator.status',
          attributes: { target },
        });
        try {
          const status = await allocator.getStatus(target);
          return new Response(JSON.stringify(status), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (url.pathname === '/allocation/roi') {
        const range = url.searchParams.get('range') || '30d';
        const roi = await allocator.getRoi(range);
        return new Response(JSON.stringify(roi), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (url.pathname === '/rebalance' && method === 'POST') {
        const span = await startSpan({
          service: 'capital-allocator',
          operation: 'allocator.rebalance',
        });
        try {
          const result = await allocator.rebalance();
          recordMetric('allocator.rebalance', result.moves.length, {});
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } finally {
          span.end();
        }
      }

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Capital Allocator', { status: 200 });
    } catch (error: any) {
      logger.error('Request failed', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const allocator = new CapitalAllocator(env.ALLOCATOR_DB, logger, env);
    const span = await startSpan({
      service: 'capital-allocator',
      operation: 'allocator.rebalance',
    });
    try {
      await allocator.rebalance();
    } finally {
      span.end();
    }
  },
};
