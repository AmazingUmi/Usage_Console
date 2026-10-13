import React from 'react';
import { DollarSign, Activity, Database, Sparkles } from 'lucide-react';
import type { UsageSummary, UsageRange } from '../types';

interface UsageMetricsProps {
  summary: UsageSummary;
  range: UsageRange;
  onRangeChange: (range: UsageRange) => void;
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export const UsageMetrics: React.FC<UsageMetricsProps> = ({ summary, range, onRangeChange }) => {
  const ranges: { label: string; value: UsageRange }[] = [
    { label: '今天', value: 'today' },
    { label: '近7天', value: '7d' },
    { label: '近30天', value: '30d' },
    { label: '全部记录', value: 'all' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">用量与开销统计</h2>
          <p className="text-xs text-slate-400">本机实际调用的 Token 消耗与官方价目表估算</p>
        </div>

        {/* Range picker buttons */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium">
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={`px-3 py-1 rounded-md transition ${
                range === r.value
                  ? 'bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Tokens */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">消耗总 Token</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatTokens(summary.totalTokens)}
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
            <span>输入: {formatTokens(summary.inputTokens)}</span>
            <span>·</span>
            <span>输出: {formatTokens(summary.outputTokens)}</span>
          </div>
        </div>

        {/* Estimated Cost */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">估算费用 (USD)</span>
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            ${summary.estimatedCostUsd.toFixed(3)}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            折合约 ¥{(summary.estimatedCostUsd * 7.25).toFixed(2)} CNY
          </div>
        </div>

        {/* Requests Count */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">请求调用量</span>
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {summary.requestCount.toLocaleString()} <span className="text-sm font-normal text-slate-400">次</span>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            平均每轮: {summary.requestCount > 0 ? formatTokens(Math.round(summary.totalTokens / summary.requestCount)) : 0} tokens
          </div>
        </div>

        {/* Reasoning / Cache Read */}
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">缓存命中 / 思考</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">
            {formatTokens(summary.cacheReadTokens)}
          </div>
          <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
            <span>推理输出: {formatTokens(summary.reasoningTokens)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
