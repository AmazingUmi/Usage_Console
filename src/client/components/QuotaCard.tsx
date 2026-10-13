import React from 'react';
import type { ProviderQuota, QuotaWindow } from '../types';
import { collectQuotaWindows } from '../lib/quota';
import { Icon } from './Icon';

interface QuotaCardProps {
  quota: ProviderQuota;
  includeAgyClaude?: boolean;
  onEdit?: (quota: ProviderQuota) => void;
}

function providerVisuals(provider: string) {
  const p = provider.toLowerCase();
  if (p.includes('codex') || p.includes('openai')) return { pc: 'var(--p-codex)', icon: 'O' };
  if (p.includes('claude') || p.includes('anthropic')) return { pc: 'var(--p-claude)', icon: 'C' };
  if (p.includes('grok') || p.includes('xai')) return { pc: 'var(--p-grok)', icon: 'G' };
  if (p.includes('antigravity') || p.includes('gemini') || p.includes('google')) return { pc: 'var(--p-agy)', icon: 'A' };
  return { pc: 'var(--accent)', icon: '•' };
}

function niceWindowLabel(label: string): string {
  if (/5\s*-?\s*hour/i.test(label) || label === 'primary') return '5 小时';
  if (/week/i.test(label) || label === 'secondary') return '每周';
  return label.replace(/ Limit Remaining$/i, '').replace(/ limit/i, '');
}

const STATUS: Record<ProviderQuota['status'], { label: string; tone: string }> = {
  ok: { label: '正常', tone: 'good' },
  warning: { label: '注意', tone: 'warning' },
  error: { label: '异常', tone: 'danger' },
  unconfigured: { label: '未连接', tone: 'muted' },
};

function shortCountdown(resetAt?: number): string {
  if (!resetAt) return '';
  const diff = resetAt - Date.now();
  if (diff <= 0) return '即将重置';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分`;
  return `${Math.max(1, minutes)}分钟`;
}

const Battery: React.FC<{ window: QuotaWindow }> = ({ window: win }) => {
  const known = Number.isFinite(win.remainingPercent);
  const percent = known ? Math.min(100, Math.max(0, win.remainingPercent)) : 0;
  const level = !known ? 'unknown' : percent <= 20 ? 'low' : percent <= 50 ? 'warning' : 'normal';
  const label = niceWindowLabel(win.label);
  const countdown = shortCountdown(win.resetAt);
  return (
    <div className="gauge-row" data-level={level} style={{ '--v': percent } as React.CSSProperties}>
      <span className="gauge-label" title={label}>{label}</span>
      <div className="battery-stage">
        <div className="battery" role="img" aria-label={`${label} 剩余 ${known ? `${Math.round(percent)}%` : '未知'}`}>
          <i className="battery-fill" style={{ height: `${percent}%` }} />
        </div>
      </div>
      <span className="gauge-val">{known ? Math.round(percent) : '—'}{known && <small>%</small>}</span>
      <span className="gauge-reset" title={win.resetAt ? `重置于 ${new Date(win.resetAt).toLocaleString()}` : undefined}>
        <Icon name="refresh" size={10} />
        {countdown || '周期重置'}
      </span>
    </div>
  );
};

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota, includeAgyClaude = false, onEdit }) => {
  const visuals = providerVisuals(quota.provider);
  const status = STATUS[quota.status] || STATUS.unconfigured;
  const { windows, groupLabel, hiddenClaude } = collectQuotaWindows(quota, includeAgyClaude);
  const subtitle = [quota.email, quota.plan, groupLabel, hiddenClaude ? '已隐藏 Claude 分组' : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="panel provider-card" style={{ '--pc': visuals.pc } as React.CSSProperties}>
      <header className="provider-heading">
        <span className="provider-icon" aria-hidden="true">{visuals.icon}</span>
        <div className="provider-title">
          <h3 title={quota.displayName}>{quota.displayName}</h3>
          <p title={subtitle}>{subtitle || '官方额度'}</p>
        </div>
        <span className="badge" data-tone={status.tone}>{status.label}</span>
      </header>

      <div className="quota-body">
        {quota.errorMessage && (
          <div className="callout" data-tone={quota.status === 'error' ? 'danger' : quota.status === 'unconfigured' ? 'info' : undefined}>
            <Icon name={quota.status === 'unconfigured' ? 'info' : 'alert'} size={15} />
            <span>{quota.errorMessage}</span>
          </div>
        )}
        {windows.length > 0 && (
          <div
            className="gauge"
            data-count={windows.length}
            style={{ '--cols': windows.length === 4 ? 2 : Math.min(windows.length, 3) } as React.CSSProperties}
          >
            {windows.map((win, idx) => <Battery key={`${win.label}-${idx}`} window={win} />)}
          </div>
        )}
        {windows.length === 0 && !quota.errorMessage && <p className="hint">暂无额度窗口数据</p>}
      </div>

      <footer className="provider-foot">
        <span>{quota.capturedAt ? `读数 ${new Date(quota.capturedAt).toLocaleTimeString()}` : '尚无读数'}</span>
        {onEdit && quota.accountCardId && (
          <span className="actions">
            <button type="button" className="text-link" onClick={() => onEdit(quota)}>编辑</button>
          </span>
        )}
      </footer>
    </article>
  );
};
