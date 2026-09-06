import { Logger, createLogger } from '../../shared/logger';
import { withTimeout } from '../../shared/retry';
import { CapitalMachineError } from '../../shared/errors';

export interface HealthCheckResult {
  module: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  lastSuccess?: number;
  lastFailure?: number;
  errorCount: number;
  details?: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  latencyMs: number;
  error?: string;
}

export class HealthMonitor {
  private env: { CAPITAL_DB: D1Database; CAPITAL_KV: KVNamespace };
  private logger: Logger;

  constructor(env: any) {
    this.env = env;
    this.logger = createLogger('health-monitor');
  }

  async runAllChecks(): Promise<Record<string, HealthCheckResult>> {
    const modules = [
      'database',
      'yield-vault',
      'mev-arbitrage',
      'fundraising-agent',
      'auto-compounder',
      'cashback-collector',
      'ip-licensing',
      'micro-savings',
      'affiliate-fleet',
      'airdrop-harvester',
      'data-monetization',
    ];

    const results: Record<string, HealthCheckResult> = {};
    const checkPromises = modules.map(async (module) => {
      try {
        const result = await withTimeout(
          () => this.checkModule(module),
          15000
        );
        results[module] = result;
      } catch (error: any) {
        results[module] = {
          module,
          status: 'unhealthy',
          latencyMs: 0,
          errorCount: 1,
          details: `Health check timed out or failed: ${error.message}`,
          checks: [{
            name: 'overall',
            status: 'failed',
            latencyMs: 0,
            error: error.message,
          }],
        };
      }
    });

    await Promise.all(checkPromises);
    return results;
  }

  async checkModule(module: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];
    let errorCount = 0;

    switch (module) {
      case 'database':
        return this.checkDatabase();
      case 'yield-vault':
        return this.checkYieldVault();
      case 'mev-arbitrage':
        return this.checkMEV();
      case 'fundraising-agent':
        return this.checkFundraising();
      case 'auto-compounder':
        return this.checkCompounder();
      case 'cashback-collector':
        return this.checkCashback();
      case 'ip-licensing':
        return this.checkIPLicensing();
      case 'micro-savings':
        return this.checkMicroSavings();
      case 'affiliate-fleet':
        return this.checkAffiliate();
      case 'airdrop-harvester':
        return this.checkAirdrop();
      case 'data-monetization':
        return this.checkDataMonetization();
      default:
        return {
          module,
          status: 'unhealthy',
          latencyMs: Date.now() - startTime,
          errorCount: 1,
          details: `Unknown module: ${module}`,
          checks: [],
        };
    }
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    // Check D1 connection
    try {
      const dbStart = Date.now();
      const result = await this.env.CAPITAL_DB.prepare('SELECT 1 as alive').first();
      checks.push({
        name: 'd1_connection',
        status: 'passed',
        latencyMs: Date.now() - dbStart,
      });
    } catch (error: any) {
      checks.push({
        name: 'd1_connection',
        status: 'failed',
        latencyMs: Date.now() - startTime,
        error: error.message,
      });
      return {
        module: 'database',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks,
      };
    }

    // Check KV connection
    try {
      const kvStart = Date.now();
      await this.env.CAPITAL_KV.get('health:check');
      checks.push({
        name: 'kv_connection',
        status: 'passed',
        latencyMs: Date.now() - kvStart,
      });
    } catch (error: any) {
      checks.push({
        name: 'kv_connection',
        status: 'failed',
        latencyMs: Date.now() - startTime,
        error: error.message,
      });
      return {
        module: 'database',
        status: 'degraded',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks,
      };
    }

    // Check table counts
    const tables = ['vault_deposits', 'arbitrage_opportunities', 'leads', 'staking_positions',
      'cashback_transactions', 'ip_assets', 'savings_accounts', 'affiliate_clicks',
      'airdrop_claims', 'data_api_keys'];

    let tableErrors = 0;
    for (const table of tables) {
      try {
        const tableStart = Date.now();
        await this.env.CAPITAL_DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first();
        checks.push({
          name: `table_${table}`,
          status: 'passed',
          latencyMs: Date.now() - tableStart,
        });
      } catch {
        checks.push({
          name: `table_${table}`,
          status: 'failed',
          latencyMs: 0,
          error: `Table ${table} not accessible`,
        });
        tableErrors++;
      }
    }

    const status = tableErrors === 0 ? 'healthy' : tableErrors > 3 ? 'unhealthy' : 'degraded';

    return {
      module: 'database',
      status,
      latencyMs: Date.now() - startTime,
      errorCount: tableErrors,
      details: `${tables.length - tableErrors}/${tables.length} tables accessible`,
      checks,
    };
  }

  private async checkYieldVault(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const stratStart = Date.now();
      const strategies = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM vault_strategies WHERE active = 1'
      ).first();
      checks.push({
        name: 'active_strategies',
        status: 'passed',
        latencyMs: Date.now() - stratStart,
      });

      const depositsStart = Date.now();
      const deposits = await this.env.CAPITAL_DB.prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM vault_deposits WHERE status = 'active'"
      ).first();
      checks.push({
        name: 'active_deposits',
        status: 'passed',
        latencyMs: Date.now() - depositsStart,
      });

      const rebalanceStart = Date.now();
      const lastRebalance = await this.env.CAPITAL_DB.prepare(
        'SELECT timestamp FROM vault_rebalances ORDER BY timestamp DESC LIMIT 1'
      ).first();
      checks.push({
        name: 'last_rebalance',
        status: lastRebalance ? 'passed' : 'skipped',
        latencyMs: Date.now() - rebalanceStart,
      });

      const staleRebalance = lastRebalance && (Date.now() - (lastRebalance as any).timestamp) > 86400000;
      if (staleRebalance) {
        checks.push({
          name: 'rebalance_freshness',
          status: 'failed',
          latencyMs: 0,
          error: 'Last rebalance was more than 24 hours ago',
        });
      }

      return {
        module: 'yield-vault',
        status: staleRebalance ? 'degraded' : 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: staleRebalance ? 1 : 0,
        details: `${(deposits as any)?.count || 0} deposits, ${(strategies as any)?.count || 0} active strategies`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'yield-vault',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        details: error.message,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkMEV(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const chainStart = Date.now();
      const stats = await this.env.CAPITAL_DB.prepare('SELECT * FROM arbitrage_stats ORDER BY updated_at DESC').all();
      checks.push({
        name: 'arbitrage_stats',
        status: 'passed',
        latencyMs: Date.now() - chainStart,
      });

      const pendingStart = Date.now();
      const pending = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM arbitrage_opportunities WHERE executed = 0'
      ).first();
      checks.push({
        name: 'pending_opportunities',
        status: 'passed',
        latencyMs: Date.now() - pendingStart,
      });

      const recentStart = Date.now();
      const recentExec = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM arbitrage_executions WHERE executed_at > ?'
      ).bind(Date.now() - 3600000).first();
      checks.push({
        name: 'recent_executions',
        status: 'passed',
        latencyMs: Date.now() - recentStart,
      });

      const hasRecentExecutions = (recentExec as any)?.count > 0;
      const hasPending = (pending as any)?.count > 0;

      return {
        module: 'mev-arbitrage',
        status: hasRecentExecutions || hasPending ? 'healthy' : 'degraded',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(pending as any)?.count || 0} pending, recent activity: ${hasRecentExecutions}`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'mev-arbitrage',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        details: error.message,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkFundraising(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const leadCheck = await this.checkTable('leads', 'Lead count');
      checks.push(leadCheck);

      const scrapeStart = Date.now();
      const recentScrape = await this.env.CAPITAL_DB.prepare(
        'SELECT * FROM scraping_logs ORDER BY created_at DESC LIMIT 3'
      ).all();
      checks.push({
        name: 'recent_scrapes',
        status: recentScrape.results && recentScrape.results.length > 0 ? 'passed' : 'skipped',
        latencyMs: Date.now() - scrapeStart,
      });

      const engageStart = Date.now();
      const engagements = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM engagements WHERE sent_at > ?'
      ).bind(Date.now() - 86400000).first();
      checks.push({
        name: 'daily_engagements',
        status: 'passed',
        latencyMs: Date.now() - engageStart,
      });

      return {
        module: 'fundraising-agent',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(engagements as any)?.count || 0} engagements today`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'fundraising-agent',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        details: error.message,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkCompounder(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const posStart = Date.now();
      const positions = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM staking_positions WHERE active = 1'
      ).first();
      checks.push({
        name: 'active_positions',
        status: 'passed',
        latencyMs: Date.now() - posStart,
      });

      const compoundStart = Date.now();
      const lastCompound = await this.env.CAPITAL_DB.prepare(
        'SELECT compounded_at FROM compound_history ORDER BY compounded_at DESC LIMIT 1'
      ).first();
      checks.push({
        name: 'last_compound',
        status: lastCompound ? 'passed' : 'skipped',
        latencyMs: Date.now() - compoundStart,
      });

      return {
        module: 'auto-compounder',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(positions as any)?.count || 0} positions, $${(positions as any)?.total || 0} staked`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'auto-compounder',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkCashback(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const srcStart = Date.now();
      const sources = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM cashback_sources WHERE active = 1'
      ).first();
      checks.push({
        name: 'active_sources',
        status: 'passed',
        latencyMs: Date.now() - srcStart,
      });

      const pendingStart = Date.now();
      const pending = await this.env.CAPITAL_DB.prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM cashback_transactions WHERE status = 'pending'"
      ).first();
      checks.push({
        name: 'pending_claims',
        status: 'passed',
        latencyMs: Date.now() - pendingStart,
      });

      return {
        module: 'cashback-collector',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(pending as any)?.count || 0} pending, $${(pending as any)?.total || 0} unclaimed`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'cashback-collector',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkIPLicensing(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const assetStart = Date.now();
      const assets = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM ip_assets WHERE status = ?'
      ).bind('active').first();
      checks.push({
        name: 'active_assets',
        status: 'passed',
        latencyMs: Date.now() - assetStart,
      });

      const licenseStart = Date.now();
      const licenses = await this.env.CAPITAL_DB.prepare(
        "SELECT COUNT(*) as count FROM licenses WHERE status = 'active'"
      ).first();
      checks.push({
        name: 'active_licenses',
        status: 'passed',
        latencyMs: Date.now() - licenseStart,
      });

      const royaltyStart = Date.now();
      const royalties = await this.env.CAPITAL_DB.prepare(
        "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM license_payments WHERE status = 'paid'"
      ).first();
      checks.push({
        name: 'total_royalties',
        status: 'passed',
        latencyMs: Date.now() - royaltyStart,
      });

      return {
        module: 'ip-licensing',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(assets as any)?.count || 0} assets, ${(licenses as any)?.count || 0} licenses`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'ip-licensing',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkMicroSavings(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const acctStart = Date.now();
      const accounts = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count, COALESCE(SUM(CAST(total_saved AS REAL)), 0) as total FROM savings_accounts WHERE active = 1'
      ).first();
      checks.push({
        name: 'active_accounts',
        status: 'passed',
        latencyMs: Date.now() - acctStart,
      });

      const pendingStart = Date.now();
      const pending = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM savings_roundups WHERE deposited = 0'
      ).first();
      checks.push({
        name: 'pending_roundups',
        status: 'passed',
        latencyMs: Date.now() - pendingStart,
      });

      return {
        module: 'micro-savings',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(accounts as any)?.count || 0} accounts, ${(pending as any)?.count || 0} pending roundups`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'micro-savings',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkAffiliate(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const progStart = Date.now();
      const programs = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM affiliate_programs WHERE active = 1'
      ).first();
      checks.push({
        name: 'active_programs',
        status: 'passed',
        latencyMs: Date.now() - progStart,
      });

      const clickStart = Date.now();
      const clicks = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM affiliate_clicks WHERE clicked_at > ?'
      ).bind(Date.now() - 86400000).first();
      checks.push({
        name: 'daily_clicks',
        status: 'passed',
        latencyMs: Date.now() - clickStart,
      });

      return {
        module: 'affiliate-fleet',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(clicks as any)?.count || 0} clicks today`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'affiliate-fleet',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkAirdrop(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const protocolStart = Date.now();
      const protocols = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM airdrop_protocols WHERE active = 1'
      ).first();
      checks.push({
        name: 'monitored_protocols',
        status: 'passed',
        latencyMs: Date.now() - protocolStart,
      });

      const eligibleStart = Date.now();
      const eligible = await this.env.CAPITAL_DB.prepare(
        "SELECT COUNT(*) as count FROM airdrop_claims WHERE eligibility_status = 'eligible' AND claimed = 0"
      ).first();
      checks.push({
        name: 'unclaimed_eligible',
        status: 'passed',
        latencyMs: Date.now() - eligibleStart,
      });

      return {
        module: 'airdrop-harvester',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(eligible as any)?.count || 0} unclaimed eligible drops`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'airdrop-harvester',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkDataMonetization(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    try {
      const keyStart = Date.now();
      const keys = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count, tier FROM data_api_keys WHERE active = 1 GROUP BY tier'
      ).all();
      checks.push({
        name: 'active_api_keys',
        status: 'passed',
        latencyMs: Date.now() - keyStart,
      });

      const queryStart = Date.now();
      const queries = await this.env.CAPITAL_DB.prepare(
        'SELECT COUNT(*) as count FROM data_queries WHERE created_at > ?'
      ).bind(Date.now() - 86400000).first();
      checks.push({
        name: 'daily_queries',
        status: 'passed',
        latencyMs: Date.now() - queryStart,
      });

      return {
        module: 'data-monetization',
        status: 'healthy',
        latencyMs: Date.now() - startTime,
        errorCount: 0,
        details: `${(queries as any)?.count || 0} queries today`,
        checks,
      };
    } catch (error: any) {
      return {
        module: 'data-monetization',
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        errorCount: 1,
        checks: [{ name: 'overall', status: 'failed', latencyMs: 0, error: error.message }],
      };
    }
  }

  private async checkTable(name: string, label: string): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const result = await this.env.CAPITAL_DB.prepare(
        `SELECT COUNT(*) as count FROM ${name}`
      ).first();
      return {
        name: label,
        status: 'passed',
        latencyMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        name: label,
        status: 'failed',
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  async autoRecover(): Promise<{ recovered: string[]; failed: string[] }> {
    const results = await this.runAllChecks();
    const recovered: string[] = [];
    const failed: string[] = [];

    for (const [module, result] of Object.entries(results)) {
      if (result.status === 'unhealthy' || result.status === 'degraded') {
        try {
          await this.attemptRecovery(module);
          recovered.push(module);
        } catch {
          failed.push(module);
        }
      }
    }

    return { recovered, failed };
  }

  private async attemptRecovery(module: string): Promise<void> {
    this.logger.warn(`Attempting auto-recovery for module: ${module}`);

    switch (module) {
      case 'database':
        // D1 and KV auto-recover, just log
        this.logger.info('Database should auto-recover — checking on next cycle');
        break;

      case 'mev-arbitrage':
        // Reset stale pending opportunities
        await this.env.CAPITAL_DB.prepare(
          `UPDATE arbitrage_opportunities SET executed = 1 WHERE executed = 0 AND created_at < ?`
        ).bind(Date.now() - 86400000).run();
        break;

      case 'cashback-collector':
        // Reset stuck claims back to pending
        await this.env.CAPITAL_DB.prepare(
          `UPDATE cashback_transactions SET status = 'pending' WHERE status = 'failed' AND created_at > ?`
        ).bind(Date.now() - 3600000).run();
        break;

      case 'affiliate-fleet':
        // Clear stale API tokens forcing refresh
        await this.env.CAPITAL_KV.delete('twitter_token');
        break;

      case 'airdrop-harvester':
        // Reset failed claims for retry
        await this.env.CAPITAL_DB.prepare(
          `UPDATE airdrop_claims SET eligibility_status = 'unknown' WHERE eligibility_status = 'error'`
        ).run();
        break;

      default:
        // General recovery: re-enable module
        await this.env.CAPITAL_KV.put(`recovery:${module}`, JSON.stringify({
          recoveredAt: Date.now(),
          previousStatus: 'unhealthy',
        }));
    }
  }
}
