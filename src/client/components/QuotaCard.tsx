import React from 'react';
import { Clock, HelpCircle, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ProviderQuota, QuotaWindow } from '../types';

interface QuotaCardProps {
  quota: ProviderQuota;
}

function formatCountdown(resetAt?: number): string {
  if (!resetAt) return '';
  const diff = resetAt - Date.now();
  if (diff <= 0) return '即将重置';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainHours = hours % 24;
    return `${days}天${remainHours}小时后重置`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分后重置`;
  }
  return `${minutes}分钟后重置`;
}

function getProviderTheme(provider: string, plan?: string): {
  icon: string;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
} {
  const p = provider.toLowerCase();
  if (p.includes('codex') || p.includes('openai')) {
    return {
      icon: 'O',
      iconBg: 'bg-emerald-500/15 border-emerald-500/20',
      iconColor: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/10 border-emerald-500/25',
      badgeText: 'text-emerald-300',
    };
  }
  if (p.includes('antigravity') || p.includes('gemini') || p.includes('google')) {
    return {
      icon: 'G',
      iconBg: 'bg-blue-500/15 border-blue-500/20',
      iconColor: 'text-blue-400',
      badgeBg: 'bg-blue-500/10 border-blue-500/25',
      badgeText: 'text-blue-300',
    };
  }
  if (p.includes('claude') || p.includes('anthropic')) {
    return {
      icon: 'C',
      iconBg: 'bg-orange-500/15 border-orange-500/20',
      iconColor: 'text-orange-400',
      badgeBg: 'bg-orange-500/10 border-orange-500/25',
      badgeText: 'text-orange-300',
    };
  }
  if (p.includes('grok') || p.includes('xai')) {
    return {
      icon: 'X',
      iconBg: 'bg-purple-500/15 border-purple-500/20',
      iconColor: 'text-purple-400',
      badgeBg: 'bg-purple-500/10 border-purple-500/25',
      badgeText: 'text-purple-300',
    };
  }
  return {
    icon: '⚡',
    iconBg: 'bg-slate-500/15 border-slate-500/20',
    iconColor: 'text-slate-300',
    badgeBg: 'bg-slate-500/10 border-slate-500/25',
    badgeText: 'text-slate-300',
  };
}

const ProgressBar: React.FC<{ window: QuotaWindow }> = ({ window: win }) => {
  const percent = Math.min(100, Math.max(0, win.remainingPercent));
  const countdown = formatCountdown(win.resetAt);

  // Status colors based on remaining quota percentage
  let barColor = 'bg-emerald-500';
  let textColor = 'text-emerald-400';
  if (percent <= 20) {
    barColor = 'bg-rose-500';
    textColor = 'text-rose-400';
  } else if (percent <= 50) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-400';
  }

  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300 font-medium">{win.label}</span>
        <div className="flex items-center gap-2 tabular-nums">
          {countdown && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400 font-normal">
              <Clock className="w-3 h-3 text-slate-500" />
              {countdown}
            </span>
          )}
          <span className={`font-semibold ${textColor}`}>
            {percent.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="w-full bg-slate-900/90 rounded-full h-2 overflow-hidden p-0.5 border border-white/5">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota }) => {
  const theme = getProviderTheme(quota.provider, quota.plan);

  return (
    <article className="glass-panel p-5 flex flex-col justify-between transition-all hover:border-white/20">
      <div>
        {/* Card Header */}
        <header className="flex items-center justify-between pb-3 mb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <span className={`w-7 h-7 rounded-lg border flex items-center justify-center font-bold font-mono text-xs ${theme.iconBg} ${theme.iconColor}`}>
              {theme.icon}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">{quota.displayName}</h3>
              {quota.plan && (
                <span className={`inline-block px-1.5 py-0.2 mt-0.5 text-[10px] font-semibold rounded border uppercase tracking-wider ${theme.badgeBg} ${theme.badgeText}`}>
                  {quota.plan}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {quota.status === 'ok' ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                正常
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-medium">
                <AlertCircle className="w-3 h-3" />
                异常
              </span>
            )}
          </div>
        </header>

        {/* Windows List */}
        {quota.windows && quota.windows.length > 0 && (
          <div className="space-y-2.5">
            {quota.windows.map((win, idx) => (
              <ProgressBar key={idx} window={win} />
            ))}
          </div>
        )}

        {/* Groups List (e.g. Antigravity) */}
        {quota.groups && quota.groups.length > 0 && (
          <div className="space-y-3">
            {quota.groups.map((group, gIdx) => (
              <div key={gIdx} className="bg-slate-900/40 p-2.5 rounded-xl border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                  <span>{group.name}</span>
                </div>
                {group.windows.map((win, wIdx) => (
                  <ProgressBar key={wIdx} window={win} />
                ))}
              </div>
            ))}
          </div>
        )}

        {quota.errorMessage && (
          <p className="text-xs text-amber-300 mt-2 bg-amber-950/30 p-2.5 rounded-lg border border-amber-800/30">
            {quota.errorMessage}
          </p>
        )}
      </div>

      {/* Footer Timestamp */}
      <footer className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
        <span>更新于 {new Date(quota.capturedAt).toLocaleTimeString()}</span>
        <span className="text-slate-400">官方 API 读数</span>
      </footer>
    </article>
  );
};
