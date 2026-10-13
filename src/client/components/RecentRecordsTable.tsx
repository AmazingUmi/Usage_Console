import React from 'react';
import { History } from 'lucide-react';
import type { TokenUsageRecord } from '../types';

interface RecentRecordsTableProps {
  records: TokenUsageRecord[];
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export const RecentRecordsTable: React.FC<RecentRecordsTableProps> = ({ records }) => {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
          <History className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200">最近调用明细</h3>
        <span className="text-xs text-slate-500">（最新 {records.length} 笔）</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800/80 text-slate-400">
              <th className="py-2 px-3 font-medium">调用时间</th>
              <th className="py-2 px-3 font-medium">渠道</th>
              <th className="py-2 px-3 font-medium">模型</th>
              <th className="py-2 px-3 font-medium">输入 Token</th>
              <th className="py-2 px-3 font-medium">输出 Token</th>
              <th className="py-2 px-3 font-medium">缓存命中</th>
              <th className="py-2 px-3 font-medium">总计</th>
              <th className="py-2 px-3 font-medium text-right">费用估算</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {records.map((r, idx) => (
              <tr key={idx} className="hover:bg-slate-800/30 transition">
                <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                  {formatDateTime(r.timestamp)}
                </td>
                <td className="py-2 px-3 font-medium text-slate-300">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/40 text-[10px]">
                    {r.provider}
                  </span>
                </td>
                <td className="py-2 px-3 font-medium text-slate-200">
                  {r.model}
                </td>
                <td className="py-2 px-3 text-slate-400">
                  {formatTokens(r.input)}
                </td>
                <td className="py-2 px-3 text-slate-400">
                  {formatTokens(r.output)}
                  {r.reasoning ? <span className="text-[10px] text-purple-400 ml-1">({formatTokens(r.reasoning)})</span> : null}
                </td>
                <td className="py-2 px-3 text-slate-400">
                  {r.cacheRead ? formatTokens(r.cacheRead) : '-'}
                </td>
                <td className="py-2 px-3 font-semibold text-slate-200">
                  {formatTokens(r.totalTokens)}
                </td>
                <td className="py-2 px-3 font-medium text-right text-emerald-400">
                  ${(r.estimatedCostUsd || 0).toFixed(4)}
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-slate-500">
                  暂无调用记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
