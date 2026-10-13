import React, { useState } from 'react';
import { PieChart } from 'lucide-react';
import type { GroupedUsage } from '../types';

interface BreakdownTableProps {
  models: GroupedUsage[];
  providers: GroupedUsage[];
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export const BreakdownTable: React.FC<BreakdownTableProps> = ({ models, providers }) => {
  const [tab, setTab] = useState<'model' | 'provider'>('model');
  const currentList = tab === 'model' ? models : providers;

  return (
    <div className="glass-panel p-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/15 text-teal-400 border border-teal-500/20">
            <PieChart className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-white tracking-tight">消耗分布明细</h3>
        </div>

        {/* Tab switch */}
        <div className="glass-capsule flex items-center">
          <button
            onClick={() => setTab('model')}
            className={`glass-capsule-item ${tab === 'model' ? 'active' : ''}`}
          >
            按模型 ({models.length})
          </button>
          <button
            onClick={() => setTab('provider')}
            className={`glass-capsule-item ${tab === 'provider' ? 'active' : ''}`}
          >
            按渠道 ({providers.length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="py-2 px-3 font-medium">名称</th>
              <th className="py-2 px-3 font-medium">占比</th>
              <th className="py-2 px-3 font-medium">总 Token</th>
              <th className="py-2 px-3 font-medium">输入 / 输出</th>
              <th className="py-2 px-3 font-medium">调用数</th>
              <th className="py-2 px-3 font-medium text-right">估算费用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 tabular-nums">
            {currentList.map((item) => (
              <tr key={item.name} className="hover:bg-white/[0.03] transition">
                <td className="py-2.5 px-3 font-medium text-slate-200 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                  <span className="font-mono text-xs">{item.name}</span>
                </td>
                <td className="py-2.5 px-3 min-w-[120px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-white/5">
                      <div
                        className="bg-blue-500 h-full rounded-full"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 w-9 text-right font-mono">{item.percentage}%</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 font-semibold text-white">
                  {formatTokens(item.totalTokens)}
                </td>
                <td className="py-2.5 px-3 text-slate-400">
                  {formatTokens(item.inputTokens)} / {formatTokens(item.outputTokens)}
                </td>
                <td className="py-2.5 px-3 text-slate-400">
                  {item.requestCount} 次
                </td>
                <td className="py-2.5 px-3 font-medium text-right text-emerald-400">
                  ${item.estimatedCostUsd.toFixed(3)}
                </td>
              </tr>
            ))}
            {currentList.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  暂无数据记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
