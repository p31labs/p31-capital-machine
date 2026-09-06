import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar
} from 'recharts';
import { fetchRevenueSummary, fetchLedgerEntries } from '../lib/api';

const COLORS = ['#00F0FF', '#A78BFA', '#FBBF24', '#34D399', '#FB7185', '#818CF8'];

export default function RevenueChart() {
  const [summary, setSummary] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, l] = await Promise.all([
          fetchRevenueSummary('30d'),
          fetchLedgerEntries(200, 0),
        ]);
        setSummary(s);
        setLedger(l);
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
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-panel p-4 rounded-2xl animate-pulse">
              <div className="h-3 bg-surface-2 rounded w-16 mb-2" />
              <div className="h-6 bg-surface-2 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-quantum-red">Failed to load revenue data</div>;
  }

  const sourceData = Object.entries(summary.by_source || {}).map(([name, value]) => ({ name, value }));
  const dailyData = (summary.daily || []).map((d: any) => ({ date: d.date, ...d }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassCard title="Total USDC" value={`$${(summary.total_usdc || 0).toLocaleString()}`} />
        <GlassCard title="Total EUR" value={`€${(summary.total_eur || 0).toLocaleString()}`} />
        <GlassCard title="Total LOVE" value={(summary.total_love || 0).toLocaleString()} />
        <GlassCard title="Transactions" value={(summary.transaction_count || 0).toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Revenue Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={dailyData}>
              <defs>
                {COLORS.map((color, i) => (
                  <linearGradient key={i} id={`color${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" stroke="#A1A1AA" fontSize={12} />
              <YAxis stroke="#A1A1AA" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
                itemStyle={{ color: '#F5F5F7' }}
              />
              {['usdc', 'eur', 'love'].map((key, i) => (
                <Area key={key} type="monotone" dataKey={key} stroke={COLORS[i]} fill={`url(#color${i})`} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">By Source</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={sourceData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
                {sourceData.map((entry, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
                itemStyle={{ color: '#F5F5F7' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-4 space-y-2">
            {sourceData.map((entry, i) => (
              <div key={entry.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-text-secondary capitalize">{entry.name}</span>
                </div>
                <span className="text-text-primary font-mono">{entry.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Recent Ledger Entries</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-white/5">
                <th className="text-left py-2 px-3 font-medium">Date</th>
                <th className="text-left py-2 px-3 font-medium">Source</th>
                <th className="text-left py-2 px-3 font-medium">Amount</th>
                <th className="text-left py-2 px-3 font-medium">Currency</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledger.slice(0, 10).map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2 px-3 text-text-secondary font-mono">{new Date(entry.timestamp).toLocaleDateString()}</td>
                  <td className="py-2 px-3 text-text-primary capitalize">{entry.source}</td>
                  <td className="py-2 px-3 text-text-primary font-mono">{entry.amount}</td>
                  <td className="py-2 px-3 text-text-secondary uppercase">{entry.currency}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      entry.status === 'settled' ? 'bg-quantum-green/10 text-quantum-green' :
                      entry.status === 'pending' ? 'bg-quantum-gold/10 text-quantum-gold' :
                      'bg-quantum-red/10 text-quantum-red'
                    }`}>{entry.status}</span>
                  </td>
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
