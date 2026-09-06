import { Orchestrator } from './orchestrator';
import { Dashboard } from './dashboard';
import { HealthMonitor } from './health';
import { createLogger } from '../../shared/logger';

export interface Env {
  CAPITAL_DB: D1Database;
  CAPITAL_KV: KVNamespace;
  RPC_URL_ETH: string;
  RPC_URL_BASE: string;
  RPC_URL_ARB: string;
  RPC_URL_SOL: string;
  RPC_URL_COSMOS: string;
  PRIVATE_KEY_ETH: string;
  PRIVATE_KEY_SOL: string;
  FLASHBOTS_RELAY: string;
  OPENAI_API_KEY: string;
  DISCORD_WEBHOOK: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const orchestrator = new Orchestrator(env);
    const dashboard = new Dashboard(env);
    const health = new HealthMonitor(env);
    const logger = createLogger('capital-machine', env.ENVIRONMENT);

    try {
      // Health check — simple
      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          module: 'capital-machine',
          environment: env.ENVIRONMENT || 'production',
          timestamp: Date.now(),
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // Health check — deep
      if (path === '/health/deep') {
        const results = await health.runAllChecks();
        const overallStatus = Object.values(results).every(r => r.status === 'healthy')
          ? 'healthy'
          : Object.values(results).some(r => r.status === 'unhealthy')
            ? 'unhealthy'
            : 'degraded';
        return new Response(JSON.stringify({
          status: overallStatus,
          timestamp: Date.now(),
          modules: results,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // Health check — auto-recover
      if (path === '/health/recover' && method === 'POST') {
        const result = await health.autoRecover();
        return new Response(JSON.stringify({
          recovered: result.recovered,
          failed: result.failed,
          timestamp: Date.now(),
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // Dashboard
      if (path === '/dashboard') {
        const stats = await dashboard.getAggregatedStats();
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/dashboard/revenue') {
        const period = url.searchParams.get('period') || '30d';
        const revenue = await dashboard.getRevenueBreakdown(period);
        return new Response(JSON.stringify(revenue), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (path === '/dashboard/activity') {
        const activity = await dashboard.getRecentActivity(20);
        return new Response(JSON.stringify(activity), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Orchestrator actions
      if (path === '/actions') {
        if (method === 'GET') {
          const actions = await orchestrator.listActions();
          return new Response(JSON.stringify({ actions }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        if (method === 'POST') {
          const body = await request.json() as any;
          const action = await orchestrator.dispatchAction(body);
          return new Response(JSON.stringify({ action }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // Module status endpoints
      if (path.startsWith('/module/')) {
        const moduleName = path.replace('/module/', '');
        const status = await orchestrator.getModuleStatus(moduleName);
        return new Response(JSON.stringify({ module: moduleName, status }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Cross-module capital allocation
      if (path === '/allocate') {
        if (method !== 'POST') {
          return new Response('Method not allowed', { status: 405 });
        }
        const body = await request.json() as any;
        const result = await orchestrator.allocateCapital(body);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({
        error: 'Not found',
        available: [
          'GET /health',
          'GET /health/deep',
          'POST /health/recover',
          'GET /dashboard',
          'GET /dashboard/revenue?period=30d',
          'GET /dashboard/activity',
          'GET /actions',
          'POST /actions',
          'GET /module/:name',
          'POST /allocate',
        ],
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: env.ENVIRONMENT === 'development' ? error.stack : undefined,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const orchestrator = new Orchestrator(env);
    const health = new HealthMonitor(env);
    const logger = createLogger('capital-machine', env.ENVIRONMENT);

    try {
      switch (event.cron) {
        case '*/5 * * * *':
          await logger.timed('process_pending_actions', () => orchestrator.processPendingActions());
          break;

        case '*/15 * * * *':
          await logger.timed('health_check', async () => {
            const results = await health.runAllChecks();
            const unhealthy = Object.entries(results).filter(([_, r]) => r.status === 'unhealthy');
            const degraded = Object.entries(results).filter(([_, r]) => r.status === 'degraded');

            if (unhealthy.length > 0) {
              logger.warn('Unhealthy modules detected', { unhealthy: unhealthy.map(([m]) => m) });
              const recovered = await health.autoRecover();
              if (recovered.recovered.length > 0) {
                logger.info('Auto-recovered modules', { recovered: recovered.recovered });
              }
            }

            if (degraded.length > 0) {
              logger.info('Degraded modules', { degraded: degraded.map(([m]) => m) });
            }

            await orchestrator.setModuleState('health', 'last_check', JSON.stringify({
              timestamp: Date.now(),
              healthy: Object.values(results).filter(r => r.status === 'healthy').length,
              total: Object.keys(results).length,
              unhealthy: unhealthy.map(([m]) => m),
            }));
          });
          break;

        case '0 * * * *':
          await logger.timed('rebalance_allocations', () => orchestrator.rebalanceAllocations());
          break;

        case '0 0 * * *':
          await logger.timed('daily_reconciliation', async () => {
            await orchestrator.dailyReconciliation();
            const metricsSummary = await orchestrator.getModuleStatus('health');
            logger.info('Daily reconciliation complete', {
              lastCheck: metricsSummary.state?.last_check?.value,
            });
          });
          break;
      }
    } catch (error: any) {
      logger.error('Scheduled task failed', error, { cron: event.cron });
    }
  },
};
