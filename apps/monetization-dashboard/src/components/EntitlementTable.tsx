import { useEffect, useState } from 'react';
import { fetchEntitlement, fetchBalance } from '../lib/api';
import type { Entitlement } from '../lib/api';

const SAMPLE_DIDS = [
  'did:p31:euler',
  'did:p31:gauss',
  'did:p31:noether',
  'did:p31:turing',
  'did:p31:lovelace',
  'did:p31:curie',
];

const TIER_COLORS: Record<string, string> = {
  free: 'bg-cloud/10 text-cloud',
  pro: 'bg-quantum-cyan/10 text-quantum-cyan',
  enterprise: 'bg-quantum-violet/10 text-quantum-violet',
};

export default function EntitlementTable() {
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.allSettled(
          SAMPLE_DIDS.map((did) => fetchEntitlement(did))
        );
        const data = results
          .filter((r): r is PromiseFulfilledResult<Entitlement> => r.status === 'fulfilled')
          .map((r) => r.value);
        setEntitlements(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel p-4 rounded-2xl animate-pulse">
              <div className="h-3 bg-surface-2 rounded w-16 mb-2" />
              <div className="h-6 bg-surface-2 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tierCounts = entitlements.reduce((acc, e) => {
    acc[e.tier] = (acc[e.tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalBalance = entitlements.reduce((acc, e) => acc + (e.balance_usdc || 0), 0);
  const totalUsage = entitlements.reduce((acc, e) => acc + (e.usage || 0), 0);
  const totalLimit = entitlements.reduce((acc, e) => acc + (e.limit || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <GlassCard title="Total Balance (USDC)" value={`$${totalBalance.toLocaleString()}`} />
        <GlassCard title="Total Usage" value={`${totalUsage.toLocaleString()}`} />
        <GlassCard title="Tier Breakdown" value={`${entitlements.length} users`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Tier Distribution</h3>
          <div className="space-y-3">
            {['free', 'pro', 'enterprise'].map((tier) => {
              const count = tierCounts[tier] || 0;
              const pct = entitlements.length ? (count / entitlements.length) * 100 : 0;
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-text-secondary capitalize">{tier}</span>
                    <span className="text-text-primary font-mono">{count}</span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        tier === 'free' ? 'bg-cloud' :
                        tier === 'pro' ? 'bg-quantum-cyan' :
                        'bg-quantum-violet'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Usage vs Limit</h3>
          <div className="space-y-4">
            {entitlements.map((e) => {
              const usagePct = e.limit ? Math.min((e.usage || 0) / e.limit * 100, 100) : 0;
              return (
                <div key={e.did}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-text-secondary font-mono text-xs truncate w-32">{e.did.split(':').pop()}</span>
                    <span className="text-text-primary font-mono text-xs">{usagePct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-quantum-cyan"
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-white/5 bg-white/[0.01]">
                <th className="text-left py-3 px-4 font-medium">DID</th>
                <th className="text-left py-3 px-4 font-medium">Tier</th>
                <th className="text-right py-3 px-4 font-medium">Balance</th>
                <th className="text-right py-3 px-4 font-medium">Usage</th>
                <th className="text-right py-3 px-4 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {entitlements
                .sort((a, b) => (b.balance_usdc || 0) - (a.balance_usdc || 0))
                .map((e) => (
                <tr key={e.did} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-3 px-4 text-text-primary font-mono text-xs">{e.did}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${TIER_COLORS[e.tier] || TIER_COLORS.free}`}>
                      {e.tier}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-text-primary font-mono">${(e.balance_usdc || 0).toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-text-secondary font-mono">{(e.usage || 0).toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-text-secondary font-mono">{(e.limit || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GlassCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="glass-panel p-4 rounded-2xl">
      <div className="text-xs text-cloud uppercase tracking-widest mb-1">{title}</div>
      <div className="text-2xl font-bold text-text-primary font-mono">{value}</div>
    </div>
  );
}
