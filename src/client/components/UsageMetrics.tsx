import React, { useState } from 'react';
import { Activity, DollarSign, Database, Sparkles, HelpCircle } from 'lucide-react';
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
  const [showHelp, setShowHelp] = useState(false);

  const ranges: { label: string; value: UsageRange }[] = [
    { label: '今日', value: 'today' },
    { label: '近7天', value: '7d' },
    { label: '近30天', value: '30d' },
    { label: '全部', value: 'all' },
  ];

  return (
    <div className="space-y-4">
      {/* Section Title & Capsule Range Picker */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white tracking-tight">本地用量统计</h2>
          <div className="relative">
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-slate-400 hover:text-slate-200 transition p-1 rounded-full hover:bg-white/5"
              aria-label="查看用量统计口径"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {showHelp && (
              <div className="absolute left-0 top-full mt-2 z-50 w-72 p-3 glass-panel text-xs text-slate-300 space-y-1.5 shadow-xl">
                <div className="font-semibold text-white">用量与费用统计说明</div>
                <p>数据源自本机实际会话日志与 Token 账本，增量统计输入、输出与上下文缓存。</p>
                <p className="text-slate-400">费用依照各模型官方输入输出单价估算，不代表实际扣费账单。</p>
              </div>
            )}
          </div>
        </div>

        {/* Capsule Range Picker (codex-switch style) */}
        <div className="glass-capsule flex items-center">
          {ranges.map((r) => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={`glass-capsule-item ${range === r.value ? 'active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 Glass Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Tokens Card */}
        <div className="glass-panel p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">消耗总 Token</span>
              <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white tabular-nums">
              {formatTokens(summary.totalTokens)}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center gap-1.5 tabular-nums">
            <span>输入: {formatTokens(summary.inputTokens)}</span>
            <span className="text-slate-600">·</span>
            <span>输出: {formatTokens(summary.outputTokens)}</span>
          </div>
        </div>

        {/* Estimated Cost Card */}
        <div className="glass-panel p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">估算费用 (USD)</span>
              <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white tabular-nums">
              ${summary.estimatedCostUsd.toFixed(3)}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 tabular-nums">
            折合约 ¥{(summary.estimatedCostUsd * 7.25).toFixed(2)} CNY
          </div>
        </div>

        {/* Requests Count Card */}
        <div className="glass-panel p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">请求调用量</span>
              <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                <Database className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white tabular-nums">
              {summary.requestCount.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">次</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 tabular-nums">
            平均每轮: {summary.requestCount > 0 ? formatTokens(Math.round(summary.totalTokens / summary.requestCount)) : 0} tokens
          </div>
        </div>

        {/* Cache Read / Reasoning Card */}
        <div className="glass-panel p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">缓存命中量</span>
              <div className="p-1.5 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight text-white tabular-nums">
              {formatTokens(summary.cacheReadTokens)}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center gap-1.5 tabular-nums">
            <span>推理输出: {formatTokens(summary.reasoningTokens)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
