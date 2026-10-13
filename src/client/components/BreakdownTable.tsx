import React, { useState } from 'react';
import { PieChart, Terminal, Cpu, Layers } from 'lucide-react';
import type { GroupedUsage } from '../types';

interface BreakdownTableProps {
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function getClientLabel(clientKey: string): { label: string; icon: string; badgeClass: string } {
  const k = clientKey.toLowerCase();
  if (k.includes('codex')) {
    return {
      label: 'Codex (OpenAI)',
      icon: 'O',
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    };
  }
  if (k.includes('pi')) {
    return {
      label: 'Pi Coding Agent',
      icon: 'π',
      badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    };
  }
  if (k.includes('grok')) {
    return {
      label: 'Grok Build (xAI)',
      icon: 'X',
      badgeClass: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    };
  }
  if (k.includes('claude')) {
    return {
      label: 'Claude Code',
      icon: 'C',
      badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
    };
  }
  if (k.includes('gemini') || k.includes('antigravity')) {
    return {
      label: 'Antigravity / Gemini',
      icon: 'G',
      badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/25',
    };
  }
  return {
    label: clientKey,
    icon: '⚡',
    badgeClass: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
  };
}

export const BreakdownTable: React.FC<BreakdownTableProps> = ({ models, providers, clients }) => {
  const [tab, setTab] = useState<'model' | 'client' | 'provider'>('model');

  let currentList = models;
  if (tab === 'client') currentList = clients;
  else if (tab === 'provider') currentList = providers;

  return (
    <div className="glass-panel p-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/15 text-teal-400 border border-teal-500/20">
            <PieChart className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-tight">消耗分布明细</h3>
            <span className="text-[11px] text-slate-400">支持按模型、软件客户端与服务商渠道透视</span>
          </div>
        </div>

        {/* 3 Tabs switch (codex-switch style) */}
        <div className="glass-capsule flex items-center">
          <button
            onClick={() => setTab('model')}
            className={`glass-capsule-item ${tab === 'model' ? 'active' : ''}`}
          >
            按模型 ({models.length})
          </button>
          <button
            onClick={() => setTab('client')}
            className={`glass-capsule-item ${tab === 'client' ? 'active' : ''}`}
          >
            按软件 ({clients.length})
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
              <th className="py-2 px-3 font-medium">名称 / 来源</th>
              <th className="py-2 px-3 font-medium">占比</th>
              <th className="py-2 px-3 font-medium">总 Token</th>
              <th className="py-2 px-3 font-medium">输入 / 输出</th>
              <th className="py-2 px-3 font-medium">调用轮次</th>
              <th className="py-2 px-3 font-medium text-right">估算费用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 tabular-nums">
            {currentList.map((item) => {
              const clientInfo = tab === 'client' ? getClientLabel(item.name) : null;

              return (
                <tr key={item.name} className="hover:bg-white/[0.03] transition">
                  <td className="py-2.5 px-3 font-medium text-slate-200">
                    <div className="flex items-center gap-2">
                      {tab === 'client' && clientInfo ? (
                        <>
                          <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] border ${clientInfo.badgeClass}`}>
                            {clientInfo.icon}
                          </span>
                          <span className="font-semibold text-white">{clientInfo.label}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                          <span className="font-mono text-xs text-slate-200">{item.name}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-900/80 rounded-full h-1.5 overflow-hidden border border-white/5">
                        <div
                          className="bg-blue-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-slate-400 w-9 text-right font-mono">{item.percentage}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-white">
                    {formatTokens(item.totalTokens)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                    {formatTokens(item.inputTokens)} / {formatTokens(item.outputTokens)}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">
                    {item.requestCount.toLocaleString()} 次
                  </td>
                  <td className="py-2.5 px-3 font-medium text-right text-emerald-400">
                    ${item.estimatedCostUsd.toFixed(3)}
                  </td>
                </tr>
              );
            })}
            {currentList.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  当前区间暂无数据记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
