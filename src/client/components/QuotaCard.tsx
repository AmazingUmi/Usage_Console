import React from 'react';
import { BatteryCharging, Clock, Cpu, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
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

function getPercentColor(percent: number): { bg: string; text: string; bar: string } {
  if (percent > 50) {
    return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-emerald-500' };
  }
  if (percent > 20) {
    return { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: 'bg-amber-500' };
  }
  return { bg: 'bg-rose-500/10', text: 'text-rose-400', bar: 'bg-rose-500' };
}

const ProgressBar: React.FC<{ window: QuotaWindow }> = ({ window: win }) => {
  const percent = Math.min(100, Math.max(0, win.remainingPercent));
  const colors = getPercentColor(percent);
  const countdown = formatCountdown(win.resetAt);

  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300 font-medium">{win.label}</span>
        <div className="flex items-center gap-2">
          {countdown && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              {countdown}
            </span>
          )}
          <span className={`font-semibold ${colors.text}`}>
            {percent.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden p-0.5 border border-slate-700/50">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota }) => {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-sm hover:border-slate-700 transition flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
              <Cpu className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">{quota.displayName}</h3>
              {quota.plan && (
                <span className="inline-block px-1.5 py-0.2 text-[10px] uppercase font-bold rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                  {quota.plan}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {quota.status === 'ok' ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" />
                正常
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                <AlertTriangle className="w-3 h-3" />
                异常
              </span>
            )}
          </div>
        </div>

        {/* Windows */}
        {quota.windows && quota.windows.length > 0 && (
          <div className="space-y-2.5 mt-2">
            {quota.windows.map((win, idx) => (
              <ProgressBar key={idx} window={win} />
            ))}
          </div>
        )}

        {/* Groups (e.g. Antigravity) */}
        {quota.groups && quota.groups.length > 0 && (
          <div className="space-y-3 mt-2">
            {quota.groups.map((group, gIdx) => (
              <div key={gIdx} className="space-y-1 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/40">
                <div className="text-[11px] font-semibold text-slate-400">{group.name}</div>
                {group.windows.map((win, wIdx) => (
                  <ProgressBar key={wIdx} window={win} />
                ))}
              </div>
            ))}
          </div>
        )}

        {quota.errorMessage && (
          <p className="text-xs text-amber-400/90 mt-2 bg-amber-950/30 p-2 rounded border border-amber-900/40">
            {quota.errorMessage}
          </p>
        )}
      </div>

      <div className="mt-4 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
        <span>更新于: {new Date(quota.capturedAt).toLocaleTimeString()}</span>
        <span className="text-slate-400">状态良好</span>
      </div>
    </div>
  );
};
