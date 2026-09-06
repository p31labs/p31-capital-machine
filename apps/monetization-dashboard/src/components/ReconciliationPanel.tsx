import { useEffect, useState } from 'react';
import { fetchReconciliation } from '../lib/api';
import type { ReconciliationEntry } from '../lib/api';

export default function ReconciliationPanel() {
  const [entries, setEntries] = useState<ReconciliationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchReconciliation();
        setEntries(data);
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

  const discrepancies = entries.filter((e) => e.discrepancy && Math.abs(e.discrepancy) > 0);
  const totalPayment = entries.reduce((acc, e) => acc + e.payment_balance, 0);
  const totalLedger = entries.reduce((acc, e) => acc + e.ledger_balance, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <GlassCard title="Total Payment Bal" value={`$${totalPayment.toLocaleString()}`} />
        <GlassCard title="Total Ledger Bal" value={`$${totalLedger.toLocaleString()}`} />
        <GlassCard title="Discrepancies" value={discrepancies.length.toString()} />
      </div>

      {discrepancies.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl border-quantum-red/30">
          <h3 className="text-lg font-semibold text-quantum-red mb-4">Discrepancies Detected</h3>
          <div className="space-y-3">
            {discrepancies.map((e) => (
              <div key={e.source} className="flex items-center justify-between p-4 bg-quantum-red/5 rounded-xl">
                <div>
                  <div className="text-text-primary font-medium capitalize">{e.source}</div>
                  <div className="text-text-secondary text-sm mt-1">
                    Payment: ${e.payment_balance.toLocaleString()} vs Ledger: ${e.ledger_balance.toLocaleString()}
                  </div>
                </div>
                <div className="text-quantum-red font-mono font-bold">
                  ${Math.abs(e.discrepancy!).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-white/5 bg-white/[0.01]">
                <th className="text-left py-3 px-4 font-medium">Source</th>
                <th className="text-right py-3 px-4 font-medium">Payment Balance</th>
                <th className="text-right py-3 px-4 font-medium">Ledger Balance</th>
                <th className="text-right py-3 px-4 font-medium">Discrepancy</th>
                <th className="text-left py-3 px-4 font-medium">Settlement</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const hasDiscrepancy = e.discrepancy && Math.abs(e.discrepancy) > 0;
                return (
                  <tr key={e.source} className={`border-b border-white/5 hover:bg-white/[0.02] ${hasDiscrepancy ? 'bg-quantum-red/5' : ''}`}>
                    <td className="py-3 px-4 text-text-primary font-medium capitalize">{e.source}</td>
                    <td className="py-3 px-4 text-right text-text-primary font-mono">${e.payment_balance.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-text-primary font-mono">${e.ledger_balance.toLocaleString()}</td>
                    <td className={`py-3 px-4 text-right font-mono ${hasDiscrepancy ? 'text-quantum-red font-bold' : 'text-quantum-green'}`}>
                      {e.discrepancy ? `${e.discrepancy > 0 ? '+' : ''}$${e.discrepancy.toLocaleString()}` : '$0'}
                    </td>
                    <td className="py-3 px-4">
                      <SettlementBadge status={e.settlement_status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SettlementBadge({ status }: { status: string }) {
  const colors = status === 'settled'
    ? 'bg-quantum-green/10 text-quantum-green'
    : status === 'pending'
    ? 'bg-quantum-gold/10 text-quantum-gold'
    : 'bg-quantum-red/10 text-quantum-red';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${colors}`}>
      {status}
    </span>
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
