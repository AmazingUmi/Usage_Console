import React from 'react';
import { RefreshCw, LayoutDashboard } from 'lucide-react';

interface HeaderProps {
  lastUpdated?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({ lastUpdated, onRefresh, isRefreshing }) => {
  return (
    <header className="glass-header sticky top-0 z-40 w-full px-6 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand & Title */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
              <span className="font-mono text-base font-semibold">⚡</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-white tracking-tight">用量控制台</span>
                <span className="px-1.5 py-0.2 text-[10px] font-semibold rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                  BS Console
                </span>
              </div>
              <span className="text-[11px] text-slate-400 block leading-tight">
                Codex · Claude · Antigravity · Grok
              </span>
            </div>
          </div>

          {/* Quick Nav Anchors */}
          <nav className="hidden md:flex items-center gap-1 text-xs font-medium text-slate-400 pl-4 border-l border-white/10">
            <a href="#quota-section" className="px-2.5 py-1 rounded-md hover:text-white hover:bg-white/5 transition">
              剩余额度
            </a>
            <a href="#usage-section" className="px-2.5 py-1 rounded-md hover:text-white hover:bg-white/5 transition">
              用量统计
            </a>
            <a href="#breakdown-section" className="px-2.5 py-1 rounded-md hover:text-white hover:bg-white/5 transition">
              走势明细
            </a>
          </nav>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/60 border border-white/10 text-[12px] text-slate-300">
            <span className="connection-dot" aria-hidden="true"></span>
            <span>已连接本机数据源</span>
          </div>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition active:scale-95 disabled:opacity-50 border border-blue-400/30"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? '正在同步…' : '刷新额度'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
