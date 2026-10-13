import React, { useState } from 'react';
import { Layers, PieChart } from 'lucide-react';
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
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
            <PieChart className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">消耗分布明细</h3>
        </div>

        {/* Tab switch */}
        <div className="flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg text-xs">
          <button
            onClick={() => setTab('model')}
            className={`px-3 py-1 rounded-md transition ${
              tab === 'model'
                ? 'bg-slate-800 text-emerald-400 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            按模型 ({models.length})
          </button>
          <button
            onClick={() => setTab('provider')}
            className={`px-3 py-1 rounded-md transition ${
              tab === 'provider'
                ? 'bg-slate-800 text-emerald-400 font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            按渠道 ({providers.length})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400">
              <th className="py-2 px-3 font-medium">名称</th>
              <th className="py-2 px-3 font-medium">占比</th>
              <th className="py-2 px-3 font-medium">总 Token</th>
              <th className="py-2 px-3 font-medium">输入 / 输出</th>
              <th className="py-2 px-3 font-medium">请求数</th>
              <th className="py-2 px-3 font-medium text-right">估算费用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {currentList.map((item) => (
              <tr key={item.name} className="hover:bg-slate-800/30 transition">
                <td className="py-2.5 px-3 font-medium text-slate-200 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  {item.name}
                </td>
                <td className="py-2.5 px-3 min-w-[120px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 w-8 text-right">{item.percentage}%</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 font-semibold text-slate-200">
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
                <td colSpan={6} className="py-6 text-center text-slate-500">
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
