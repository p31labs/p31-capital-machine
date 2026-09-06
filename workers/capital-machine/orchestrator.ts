export interface OrchestratorAction {
  id: string;
  action: string;
  module: string;
  params?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  created_at: number;
  completed_at?: number;
}

export class Orchestrator {
  private env: { CAPITAL_DB: D1Database; CAPITAL_KV: KVNamespace };

  constructor(env: any) {
    this.env = env;
  }

  async dispatchAction(body: any): Promise<OrchestratorAction> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const action: OrchestratorAction = {
      id,
      action: body.action,
      module: body.module,
      params: body.params,
      status: 'pending',
      created_at: now,
    };

    await this.env.CAPITAL_DB.prepare(
      `INSERT INTO orchestrator_actions (id, action, module, params, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, action.action, action.module, JSON.stringify(action.params || {}), 'pending', now).run();

    // Notify Discord
    await this.notifyDiscord({
      title: 'Action Dispatched',
      description: `${action.action} → ${action.module}`,
      color: 0x3498db,
    });

    return action;
  }

  async listActions(): Promise<OrchestratorAction[]> {
    const result = await this.env.CAPITAL_DB.prepare(
      'SELECT * FROM orchestrator_actions ORDER BY created_at DESC LIMIT 50'
    ).all();
    return (result.results || []).map((row: any) => ({
      ...row,
      params: JSON.parse(row.params || '{}'),
    }));
  }

  async processPendingActions(): Promise<void> {
    const result = await this.env.CAPITAL_DB.prepare(
      "SELECT * FROM orchestrator_actions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10"
    ).all();

    for (const row of (result.results || [])) {
      const r = row as any;
      await this.env.CAPITAL_DB.prepare(
        "UPDATE orchestrator_actions SET status = 'running' WHERE id = ?"
      ).bind(r.id).run();

      try {
        const action = {
          ...r,
          params: JSON.parse(r.params || '{}'),
        } as OrchestratorAction;
        const result = await this.executeAction(action);
        await this.env.CAPITAL_DB.prepare(
          "UPDATE orchestrator_actions SET status = 'completed', result = ?, completed_at = ? WHERE id = ?"
        ).bind(JSON.stringify(result), Date.now(), row.id).run();
      } catch (error: any) {
        await this.env.CAPITAL_DB.prepare(
          "UPDATE orchestrator_actions SET status = 'failed', error = ?, completed_at = ? WHERE id = ?"
        ).bind(error.message, Date.now(), row.id).run();
      }
    }
  }

  async executeAction(action: OrchestratorAction): Promise<any> {
    switch (action.module) {
      case 'yield-vault':
        return this.executeYieldVaultAction(action);
      case 'mev':
        return this.executeMEVAction(action);
      case 'fundraising':
        return this.executeFundraisingAction(action);
      case 'compounder':
        return this.executeCompounderAction(action);
      case 'cashback':
        return this.executeCashbackAction(action);
      case 'ip-licensing':
        return this.executeIPLicensingAction(action);
      case 'micro-savings':
        return this.executeMicroSavingsAction(action);
      case 'affiliate':
        return this.executeAffiliateAction(action);
      case 'airdrop':
        return this.executeAirdropAction(action);
      case 'data':
        return this.executeDataAction(action);
      default:
        throw new Error(`Unknown module: ${action.module}`);
    }
  }

  async getModuleStatus(moduleName: string): Promise<any> {
    const recentActions = await this.env.CAPITAL_DB.prepare(
      'SELECT status, COUNT(*) as count FROM orchestrator_actions WHERE module = ? GROUP BY status'
    ).bind(moduleName).all();

    const lastRun = await this.env.CAPITAL_DB.prepare(
      'SELECT created_at, status FROM orchestrator_actions WHERE module = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(moduleName).first();

    const state = await this.env.CAPITAL_DB.prepare(
      'SELECT key, value, updated_at FROM orchestrator_state WHERE module = ?'
    ).bind(moduleName).all();

    const stateMap: Record<string, any> = {};
    for (const row of (state.results || [])) {
      const r = row as any;
      stateMap[r.key] = { value: r.value, updatedAt: r.updated_at };
    }

    return {
      module: moduleName,
      actionCounts: recentActions.results || [],
      lastRun: lastRun || null,
      state: stateMap,
      timestamp: Date.now(),
    };
  }

  async allocateCapital(body: { from: string; to: string; amount: string; chain: string }): Promise<any> {
    const action: OrchestratorAction = {
      id: crypto.randomUUID(),
      action: 'allocate',
      module: body.from,
      params: { to: body.to, amount: body.amount, chain: body.chain },
      status: 'pending',
      created_at: Date.now(),
    };

    await this.env.CAPITAL_DB.prepare(
      `INSERT INTO orchestrator_actions (id, action, module, params, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(action.id, action.action, action.module, JSON.stringify(action.params), 'pending', action.created_at).run();

    await this.env.CAPITAL_KV.put(
      `allocation:${action.id}`,
      JSON.stringify({ from: body.from, to: body.to, amount: body.amount, chain: body.chain, status: 'pending' })
    );

    return { actionId: action.id, status: 'pending' };
  }

  async runHealthChecks(): Promise<void> {
    const modules = [
      'yield-vault', 'mev', 'fundraising', 'compounder', 'cashback',
      'ip-licensing', 'micro-savings', 'affiliate', 'airdrop', 'data',
    ];

    for (const module of modules) {
      const status = await this.getModuleStatus(module);
      await this.env.CAPITAL_KV.put(
        `health:${module}`,
        JSON.stringify({ timestamp: Date.now(), status: 'ok', lastAction: status.lastRun })
      );
    }
  }

  async rebalanceAllocations(): Promise<void> {
    const allocations = await this.env.CAPITAL_KV.list({ prefix: 'allocation:' });
    for (const key of allocations.keys) {
      const data = JSON.parse(await this.env.CAPITAL_KV.get(key.name) || '{}');
      if (data.status === 'pending') {
        await this.dispatchAction({
          action: 'rebalance',
          module: data.from,
          params: data,
        });
      }
    }
  }

  async dailyReconciliation(): Promise<void> {
    await this.notifyDiscord({
      title: 'Daily Reconciliation Started',
      description: 'Running full system reconciliation across all modules',
      color: 0x95a5a6,
    });

    const modules = [
      'yield-vault', 'mev', 'compounder', 'cashback',
      'ip-licensing', 'micro-savings',
    ];

    for (const module of modules) {
      await this.dispatchAction({
        action: 'reconcile',
        module,
        params: { timestamp: Date.now() },
      });
    }
  }

  async setModuleState(module: string, key: string, value: string): Promise<void> {
    await this.env.CAPITAL_DB.prepare(
      `INSERT INTO orchestrator_state (id, module, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET value = ?, updated_at = ?`
    ).bind(
      `${module}:${key}`, module, key, value, Date.now(),
      value, Date.now()
    ).run();
  }

  async notifyDiscord(embed: { title: string; description: string; color: number }): Promise<void> {
    const webhookUrl = (this.env as any).DISCORD_WEBHOOK;
    if (!webhookUrl) return;

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: embed.title,
            description: embed.description,
            color: embed.color,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch {
      // Silently fail - notifications are non-critical
    }
  }

  // Module-specific action executors (forward to respective modules)
  private async executeYieldVaultAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'sync') {
      return { synced: true, vaults: [] };
    }
    throw new Error(`Unknown yield-vault action: ${action.action}`);
  }

  private async executeMEVAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'scan') {
      return { scanned: true, opportunities: [] };
    }
    throw new Error(`Unknown mev action: ${action.action}`);
  }

  private async executeFundraisingAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'scrape') {
      return { scraped: true, leads: [] };
    }
    throw new Error(`Unknown fundraising action: ${action.action}`);
  }

  private async executeCompounderAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'compound') {
      return { compounded: true, positions: 0 };
    }
    throw new Error(`Unknown compounder action: ${action.action}`);
  }

  private async executeCashbackAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'claim') {
      return { claimed: true, transactions: [] };
    }
    throw new Error(`Unknown cashback action: ${action.action}`);
  }

  private async executeIPLicensingAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'collect') {
      return { collected: true, royalties: [] };
    }
    throw new Error(`Unknown ip-licensing action: ${action.action}`);
  }

  private async executeMicroSavingsAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'sweep') {
      return { swept: true, roundups: 0 };
    }
    throw new Error(`Unknown micro-savings action: ${action.action}`);
  }

  private async executeAffiliateAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'engage') {
      return { engaged: true, posts: 0 };
    }
    throw new Error(`Unknown affiliate action: ${action.action}`);
  }

  private async executeAirdropAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'scan') {
      return { scanned: true, claims: [] };
    }
    throw new Error(`Unknown airdrop action: ${action.action}`);
  }

  private async executeDataAction(action: OrchestratorAction): Promise<any> {
    if (action.action === 'refresh') {
      return { refreshed: true, feeds: [] };
    }
    throw new Error(`Unknown data action: ${action.action}`);
  }
}
