import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { fetchAllocationStatus, fetchRoi } from '../lib/api';
import type { AllocationStatus } from '../lib/api';

export default function AllocationTable() {
  const [allocations, setAllocations] = useState<AllocationStatus[]>([]);
  const [roi, setRoi] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [a, r] = await Promise.all([
          fetchAllocationStatus(),
          fetchRoi('30d'),
        ]);
        setAllocations(a);
        setRoi(r);
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

  const totalAllocated = allocations.reduce((acc, a) => acc + a.allocated, 0);
  const avgRoi = roi.length ? roi.reduce((acc, r) => acc + r.roi_bps, 0) / roi.length : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <GlassCard title="Total Allocated" value={`$${totalAllocated.toLocaleString()}`} />
        <GlassCard title="Avg ROI" value={`${avgRoi.toFixed(1)} bps`} />
        <GlassCard title="Positions" value={allocations.length.toString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Allocation by Target</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={allocations}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="target" stroke="#A1A1AA" fontSize={12} />
              <YAxis stroke="#A1A1AA" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
                itemStyle={{ color: '#F5F5F7' }}
              />
              <Bar dataKey="allocated" fill="#00F0FF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-text-primary mb-4">ROI by Target (bps)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={roi}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="target" stroke="#A1A1AA" fontSize={12} />
              <YAxis stroke="#A1A1AA" fontSize={12} />
              <Tooltip
                contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
                itemStyle={{ color: '#F5F5F7' }}
                formatter={(value: any) => [`${value} bps`, 'ROI']}
              />
              <Bar dataKey="roi_bps" fill="#A78BFA" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-white/5 bg-white/[0.01]">
                <th className="text-left py-3 px-4 font-medium">Target</th>
                <th className="text-right py-3 px-4 font-medium">Allocated</th>
                <th className="text-right py-3 px-4 font-medium">ROI (bps)</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-left py-3 px-4 font-medium">Last Rebalance</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.target} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-3 px-4 text-text-primary font-medium capitalize">{a.target}</td>
                  <td className="py-3 px-4 text-right text-text-primary font-mono">${a.allocated.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-text-primary font-mono">{a.roi_bps.toFixed(1)}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="py-3 px-4 text-text-secondary font-mono text-xs">
                    {new Date(a.last_rebalance).toLocaleDateString()}
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

function StatusBadge({ status }: { status: string }) {
  const colors = status === 'active'
    ? 'bg-quantum-green/10 text-quantum-green'
    : status === 'rebalancing'
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
