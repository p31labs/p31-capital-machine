export class Dashboard {
  private env: { CAPITAL_DB: D1Database; CAPITAL_KV: KVNamespace };

  constructor(env: any) {
    this.env = env;
  }

  async getAggregatedStats(): Promise<any> {
    const [
      vaultDeposits,
      mevProfits,
      campaignTotals,
      compoundTotals,
      cashbackTotals,
      royaltyTotals,
      savingsTotals,
      affiliateTotals,
      airdropTotals,
      actionStats,
    ] = await Promise.all([
      this.queryVaultStats(),
      this.queryMEVStats(),
      this.queryCampaignStats(),
      this.queryCompoundStats(),
      this.queryCashbackStats(),
      this.queryRoyaltyStats(),
      this.querySavingsStats(),
      this.queryAffiliateStats(),
      this.queryAirdropStats(),
      this.queryActionStats(),
    ]);

    const totalRevenue = [
      mevProfits.totalProfit,
      cashbackTotals.totalClaimed,
      royaltyTotals.totalCollected,
      affiliateTotals.totalCommissions,
      airdropTotals.totalProceeds,
    ].reduce((sum, val) => {
      const num = parseFloat(val?.toString() || '0');
      return sum + num;
    }, 0);

    return {
      timestamp: Date.now(),
      summary: {
        totalRevenue,
        activeCampaigns: campaignTotals.active,
        totalLeads: campaignTotals.totalLeads,
        totalDeposits: vaultDeposits.totalDeposits,
        activeStakingPositions: compoundTotals.activePositions,
        totalRoyalties: royaltyTotals.totalCollected,
        totalCommissions: affiliateTotals.totalCommissions,
        pendingAirdrops: airdropTotals.pending,
      },
      modules: {
        yieldVault: vaultDeposits,
        mevArbitrage: mevProfits,
        fundraising: campaignTotals,
        autoCompounder: compoundTotals,
        cashback: cashbackTotals,
        ipLicensing: royaltyTotals,
        microSavings: savingsTotals,
        affiliate: affiliateTotals,
        airdrop: airdropTotals,
      },
      actions: actionStats,
    };
  }

  async getRevenueBreakdown(period: string): Promise<any> {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const since = Date.now() - days * 86400000;

    const [mevRevenue, cashbackRevenue, royaltyRevenue, affiliateRevenue, airdropRevenue] =
      await Promise.all([
        this.queryMEVRevenue(since),
        this.queryCashbackRevenue(since),
        this.queryRoyaltyRevenue(since),
        this.queryAffiliateRevenue(since),
        this.queryAirdropRevenue(since),
      ]);

    return {
      period,
      breakdown: {
        mevArbitrage: mevRevenue,
        cashback: cashbackRevenue,
        royalties: royaltyRevenue,
        affiliate: affiliateRevenue,
        airdrops: airdropRevenue,
      },
      total: mevRevenue + cashbackRevenue + royaltyRevenue + affiliateRevenue + airdropRevenue,
    };
  }

  async getRecentActivity(limit: number): Promise<any[]> {
    const queries = await this.env.CAPITAL_DB.prepare(
      `SELECT 'arbitrage' as source, created_at, 'Executed arbitrage' as description
       FROM arbitrage_executions WHERE executed_at > ?
       UNION ALL
       SELECT 'campaign' as source, created_at, 'Campaign update' as description
       FROM campaigns WHERE updated_at > ?
       UNION ALL
       SELECT 'compound' as source, compounded_at as created_at, 'Compounded rewards' as description
       FROM compound_history WHERE compounded_at > ?
       UNION ALL
       SELECT 'cashback' as source, claimed_at as created_at, 'Claimed cashback' as description
       FROM cashback_transactions WHERE claimed_at > ?
       UNION ALL
       SELECT 'royalty' as source, paid_at as created_at, 'Received royalty' as description
       FROM license_payments WHERE paid_at > ?
       ORDER BY created_at DESC LIMIT ?`
    ).bind(
      Date.now() - 86400000 * 7,
      Date.now() - 86400000 * 7,
      Date.now() - 86400000 * 7,
      Date.now() - 86400000 * 7,
      Date.now() - 86400000 * 7,
      limit
    ).all();

    return (queries.results || []).map((row: any) => ({
      ...row,
      timestamp: row.created_at,
    }));
  }

  private async queryVaultStats(): Promise<any> {
    const total = await this.env.CAPITAL_DB.prepare(
      "SELECT COUNT(*) as count, SUM(CAST(amount AS REAL)) as total FROM vault_deposits WHERE status = 'active'"
    ).first();
    return {
      totalDeposits: total?.total || 0,
      activeDepositors: total?.count || 0,
    };
  }

  private async queryMEVStats(): Promise<any> {
    const stats = await this.env.CAPITAL_DB.prepare(
      'SELECT total_profit, total_attempts, success_count FROM arbitrage_stats ORDER BY updated_at DESC LIMIT 1'
    ).first();
    if (stats && typeof stats === 'object') {
      const s = stats as any;
      return {
        totalProfit: s.total_profit || 0,
        totalAttempts: s.total_attempts || 0,
        successCount: s.success_count || 0,
        successRate: s.total_attempts > 0
          ? Math.round((s.success_count / s.total_attempts) * 100)
          : 0,
      };
    }
    return { totalProfit: 0, totalAttempts: 0, successCount: 0, successRate: 0 };
  }

  private async queryCampaignStats(): Promise<any> {
    const active = await this.env.CAPITAL_DB.prepare(
      "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'"
    ).first();
    const totalLeads = await this.env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count FROM leads'
    ).first();
    const contacted = await this.env.CAPITAL_DB.prepare(
      "SELECT COUNT(*) as count FROM engagements WHERE status = 'sent'"
    ).first();
    return {
      active: active?.count || 0,
      totalLeads: totalLeads?.count || 0,
      contacted: contacted?.count || 0,
    };
  }

  private async queryCompoundStats(): Promise<any> {
    const active = await this.env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count, SUM(CAST(amount AS REAL)) as total FROM staking_positions WHERE active = 1'
    ).first();
    return {
      activePositions: active?.count || 0,
      totalStaked: active?.total || 0,
    };
  }

  private async queryCashbackStats(): Promise<any> {
    const stats = await this.env.CAPITAL_DB.prepare(
      'SELECT total_claimed, total_transactions FROM cashback_stats ORDER BY updated_at DESC LIMIT 1'
    ).first();
    return {
      totalClaimed: stats?.total_claimed || 0,
      totalTransactions: stats?.total_transactions || 0,
    };
  }

  private async queryRoyaltyStats(): Promise<any> {
    const total = await this.env.CAPITAL_DB.prepare(
      "SELECT SUM(CAST(amount AS REAL)) as total FROM license_payments WHERE status = 'paid'"
    ).first();
    return {
      totalCollected: total?.total || 0,
    };
  }

  private async querySavingsStats(): Promise<any> {
    const stats = await this.env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count, SUM(CAST(total_saved AS REAL)) as total FROM savings_accounts WHERE active = 1'
    ).first();
    return {
      activeAccounts: stats?.count || 0,
      totalSaved: stats?.total || 0,
    };
  }

  private async queryAffiliateStats(): Promise<any> {
    const commissions = await this.env.CAPITAL_DB.prepare(
      "SELECT SUM(CAST(amount AS REAL)) as total FROM affiliate_commissions WHERE status = 'paid'"
    ).first();
    const clicks = await this.env.CAPITAL_DB.prepare(
      'SELECT COUNT(*) as count FROM affiliate_clicks'
    ).first();
    return {
      totalCommissions: commissions?.total || 0,
      totalClicks: clicks?.count || 0,
    };
  }

  private async queryAirdropStats(): Promise<any> {
    const pending = await this.env.CAPITAL_DB.prepare(
      "SELECT COUNT(*) as count FROM airdrop_claims WHERE claimed = 0 AND eligibility_status = 'eligible'"
    ).first();
    const proceeds = await this.env.CAPITAL_DB.prepare(
      "SELECT SUM(CAST(proceeds_amount AS REAL)) as total FROM airdrop_sales WHERE status = 'completed'"
    ).first();
    return {
      pending: pending?.count || 0,
      totalProceeds: proceeds?.total || 0,
    };
  }

  private async queryActionStats(): Promise<any> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT status, COUNT(*) as count FROM orchestrator_actions GROUP BY status'
    ).all();
    return (result.results || []).reduce((acc: any, row: any) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
  }

  private async queryMEVRevenue(since: number): Promise<number> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT SUM(CAST(profit_text AS REAL)) as total FROM arbitrage_executions WHERE executed_at > ? AND status = ?'
    ).bind(since, 'success').first();
    return (result?.total || 0) as number;
  }

  private async queryCashbackRevenue(since: number): Promise<number> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT SUM(CAST(amount AS REAL)) as total FROM cashback_transactions WHERE claimed_at > ? AND status = ?'
    ).bind(since, 'claimed').first();
    return (result?.total || 0) as number;
  }

  private async queryRoyaltyRevenue(since: number): Promise<number> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT SUM(CAST(amount AS REAL)) as total FROM license_payments WHERE paid_at > ? AND status = ?'
    ).bind(since, 'paid').first();
    return (result?.total || 0) as number;
  }

  private async queryAffiliateRevenue(since: number): Promise<number> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT SUM(CAST(amount AS REAL)) as total FROM affiliate_commissions WHERE paid_at > ? AND status = ?'
    ).bind(since, 'paid').first();
    return (result?.total || 0) as number;
  }

  private async queryAirdropRevenue(since: number): Promise<number> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT SUM(CAST(proceeds_amount AS REAL)) as total FROM airdrop_sales WHERE sold_at > ? AND status = ?'
    ).bind(since, 'completed').first();
    return (result?.total || 0) as number;
  }
}
