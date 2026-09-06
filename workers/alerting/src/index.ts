export interface Env {
  SLACK_WEBHOOK_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
    }

    const health = {
      status: 'ok',
      service: 'monetization-alerting',
      timestamp: Date.now(),
      checks: {
        alerting_worker: 'healthy',
        revenue_ledger: 'https://revenue-ledger.trimtab-signal.workers.dev/health',
        entitlement: 'https://entitlement.trimtab-signal.workers.dev/health',
        capital_allocator: 'https://capital-allocator.trimtab-signal.workers.dev/health',
        dashboard: 'https://af79c8f3.chump-dashboard.pages.dev',
      },
      note: 'Cross-service metrics collection requires external monitoring (Grafana/Axiom). This worker only verifies its own health.',
    };

    return new Response(JSON.stringify(health), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const health = {
      status: 'ok',
      service: 'monetization-alerting',
      timestamp: Date.now(),
      checks: {
        alerting_worker: 'healthy',
        revenue_ledger: 'https://revenue-ledger.trimtab-signal.workers.dev/health',
        entitlement: 'https://entitlement.trimtab-signal.workers.dev/health',
        capital_allocator: 'https://capital-allocator.trimtab-signal.workers.dev/health',
        dashboard: 'https://af79c8f3.chump-dashboard.pages.dev',
      },
      note: 'Cross-service metrics collection requires external monitoring (Grafana/Axiom).',
    };

    if (env.SLACK_WEBHOOK_URL) {
      fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `P31 Monetization Engine — Alerting worker healthy. Monitor /metrics endpoints externally.`,
          username: 'P31 Alerting',
          icon_emoji: ':white_check_mark:',
        }),
      }).catch(() => {});
    }
  },
};
