import React from 'react';
import type { ProviderQuota, QuotaWindow } from '../types';
import { collectQuotaWindows } from '../lib/quota';

interface QuotaCardProps {
  quota: ProviderQuota;
  includeAgyClaude?: boolean;
  onEdit?: (quota: ProviderQuota) => void;
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
    return `${days}天${remainHours}小时`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  return `${minutes}分钟`;
}

function getProviderVisuals(provider: string) {
  const p = provider.toLowerCase();
  if (p.includes('codex') || p.includes('openai')) {
    return { id: 'codex-card', pc: 'var(--gray)', icon: 'O' };
  }
  if (p.includes('claude') || p.includes('anthropic')) {
    return { id: 'claude-card', pc: 'var(--chart-secondary)', icon: 'C' };
  }
  if (p.includes('grok') || p.includes('xai')) {
    return { id: 'grok-card', pc: 'var(--grok)', icon: 'G' };
  }
  if (p.includes('antigravity') || p.includes('gemini') || p.includes('google')) {
    return { id: 'agy-card', pc: 'var(--agy)', icon: 'A' };
  }
  return { id: `${provider}-card`, pc: 'var(--accent)', icon: '⚡' };
}

function niceWindowLabel(label: string): string {
  if (/5\s*hour/i.test(label) || label === 'primary') return '5 小时';
  if (/week/i.test(label) || label === 'secondary') return '每周';
  return label.replace(/ Limit Remaining$/i, '').replace(/ limit/i, '');
}

function statusMeta(status: ProviderQuota['status']): { label: string; color: string } {
  switch (status) {
    case 'ok':
      return { label: '已同步', color: 'var(--accent)' };
    case 'warning':
      return { label: '异常', color: 'var(--warning)' };
    case 'error':
      return { label: '失败', color: 'var(--danger)' };
    default:
      return { label: '未配置', color: 'var(--muted)' };
  }
}

const BatteryRow: React.FC<{ window: QuotaWindow; pc: string }> = ({ window: win, pc }) => {
  const known = Number.isFinite(win.remainingPercent);
  const percent = known ? Math.min(100, Math.max(0, win.remainingPercent)) : 0;
  const countdown = formatCountdown(win.resetAt);

  let level = 'normal';
  if (known && percent <= 20) level = 'low';
  else if (known && percent <= 50) level = 'warning';

  return (
    <div
      className="gauge-row"
      data-level={level}
      data-known={known ? 'true' : 'false'}
      style={{
        '--v': percent,
        '--fill': level === 'low' ? 'var(--danger)' : level === 'warning' ? 'var(--warning)' : pc,
      } as React.CSSProperties}
    >
      <div className="gauge-head">
        <span>{niceWindowLabel(win.label)}</span>
      </div>

      <div className="battery-stage">
        <div className="battery" role="img" aria-label={`${win.label}: ${known ? `${percent.toFixed(0)}%` : '未知'}`}>
          <i className="battery-fill" style={{ height: `max(${percent}%, 6px)` }}></i>
        </div>
      </div>

      <div className="gauge-val">
        {known ? percent.toFixed(0) : '—'}
        {known && <small>%</small>}
      </div>

      {countdown ? (
        <div className="gauge-reset" title={`重置时间: ${new Date(win.resetAt!).toLocaleString()}`}>
          <svg className="gauge-reset-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.6-3.7"></path>
            <path d="M12.6 2v2.6H10"></path>
          </svg>
          <small className="subtle">{countdown}</small>
        </div>
      ) : (
        <div className="gauge-reset">
          <small className="subtle">周期重置</small>
        </div>
      )}
    </div>
  );
};

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota, includeAgyClaude = false, onEdit }) => {
  const visuals = getProviderVisuals(quota.provider);
  const status = statusMeta(quota.status);
  const { windows, groupLabel, hiddenClaude } = collectQuotaWindows(quota, includeAgyClaude);
  const capturedLabel = quota.capturedAt
    ? new Date(quota.capturedAt).toLocaleTimeString()
    : '等待配置';

  return (
    <article
      id={visuals.id}
      className={`provider-card panel${quota.status === 'unconfigured' ? ' is-empty' : ''}`}
      style={{ '--pc': visuals.pc } as React.CSSProperties}
    >
      <header className="provider-heading">
        <span className="provider-icon" aria-hidden="true">
          {visuals.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{quota.displayName}</h3>
          <p className="hint">
            {quota.plan || (quota.status === 'unconfigured' ? '未检测到凭据' : '官方额度')}
            {groupLabel ? ` · ${groupLabel}` : ''}
            {hiddenClaude ? ' · 已隐藏 Claude' : ''}
          </p>
        </div>
        <span className="provider-tag" style={{ color: status.color, borderColor: 'currentColor' }}>
          {status.label}
        </span>
        <details className="info-help provider-help">
          <summary aria-label={`${quota.displayName} 额度说明`}>?</summary>
          <div className="help-content">
            <strong>{quota.displayName}</strong>
            <p>订阅类型: {quota.plan || '未配置'}</p>
            <p>读数时间: {quota.capturedAt ? new Date(quota.capturedAt).toLocaleString() : '—'}</p>
            <p>{quota.errorMessage || '通过官方 API 探针或本地缓存提取滚动与周期限额。Antigravity 的 Claude 分组可在设置中隐藏，不影响用量统计。'}</p>
          </div>
        </details>
      </header>

      <div className="quota-groups">
        <section className="quota-group">
          <div className={`gauge gauge-count-${Math.min(windows.length, 4)}`}>
            {windows.map((win, idx) => (
              <BatteryRow key={`${win.label}-${idx}`} window={win} pc={visuals.pc} />
            ))}
            {windows.length === 0 && (
              <p className="hint quota-empty-note">
                {quota.status === 'unconfigured' ? '暂未接入该平台额度' : '暂无配额窗口数据'}
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="provider-foot">
        <span>{capturedLabel}</span>
        <span>
          {onEdit && quota.accountCardId && (
            <button type="button" className="text-link" onClick={() => onEdit(quota)}>编辑</button>
          )}
          {quota.status === 'ok' ? '官方读数' : quota.status === 'unconfigured' ? '未检测到' : '本地读数'}
        </span>
      </div>
    </article>
  );
};
