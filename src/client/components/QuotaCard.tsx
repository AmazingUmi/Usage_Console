import React from 'react';
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
    return { id: 'codex-card', pc: 'var(--gray)', icon: 'O', label: 'OpenAI Codex' };
  }
  if (p.includes('claude') || p.includes('anthropic')) {
    return { id: 'claude-card', pc: 'var(--chart-secondary)', icon: 'C', label: 'Claude' };
  }
  if (p.includes('grok') || p.includes('xai')) {
    return { id: 'grok-card', pc: 'var(--grok)', icon: 'G', label: 'Grok' };
  }
  if (p.includes('antigravity') || p.includes('gemini') || p.includes('google')) {
    return { id: 'agy-card', pc: 'var(--agy)', icon: 'A', label: 'Antigravity' };
  }
  return { id: 'custom-card', pc: 'var(--accent)', icon: '⚡', label: provider };
}

function niceWindowLabel(label: string): string {
  if (/5\s*hour/i.test(label) || label === 'primary') return '5 小时';
  if (/week/i.test(label) || label === 'secondary') return '每周';
  return label.replace(/ Limit Remaining$/i, '').replace(/ limit/i, '');
}

const BatteryRow: React.FC<{ window: QuotaWindow; pc: string }> = ({ window: win, pc }) => {
  const percent = Math.min(100, Math.max(0, win.remainingPercent));
  const countdown = formatCountdown(win.resetAt);

  let level = 'normal';
  if (percent <= 20) level = 'low';
  else if (percent <= 50) level = 'warning';

  return (
    <div
      className="gauge-row"
      data-level={level}
      data-known="true"
      style={{
        '--v': percent,
        '--fill': level === 'low' ? 'var(--danger)' : level === 'warning' ? 'var(--warning)' : pc,
      } as React.CSSProperties}
    >
      <div className="gauge-head">
        <span>{niceWindowLabel(win.label)}</span>
      </div>

      <div className="battery-stage">
        <div className="battery" role="img" aria-label={`${win.label}: ${percent.toFixed(0)}%`}>
          <i className="battery-fill" style={{ height: `max(${percent}%, 6px)` }}></i>
        </div>
      </div>

      <div className="gauge-val">
        {percent.toFixed(0)}
        <small>%</small>
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

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota }) => {
  const visuals = getProviderVisuals(quota.provider);

  // Flatten windows if provider has groups (like Antigravity)
  const allWindows: QuotaWindow[] = [];
  if (quota.windows && quota.windows.length > 0) {
    allWindows.push(...quota.windows);
  } else if (quota.groups && quota.groups.length > 0) {
    for (const g of quota.groups) {
      allWindows.push(...g.windows);
    }
  }

  return (
    <article
      id={visuals.id}
      className="provider-card panel"
      style={{ '--pc': visuals.pc } as React.CSSProperties}
    >
      <header className="provider-heading">
        <span className="provider-icon" aria-hidden="true">
          {visuals.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{quota.displayName}</h3>
          <p className="hint" style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--muted)' }}>
            {quota.plan ? `已绑定官方 ${quota.plan} 订阅` : '实时额度已同步'}
          </p>
        </div>
        <details className="info-help provider-help">
          <summary aria-label={`${quota.displayName} 额度说明`}>?</summary>
          <div className="help-content">
            <strong>{quota.displayName}</strong>
            <p>订阅类型: {quota.plan || '默认'}</p>
            <p>读数时间: {new Date(quota.capturedAt).toLocaleString()}</p>
            <p>通过官方 API 探针或本地缓存提取滚动与周期限额。</p>
          </div>
        </details>
      </header>

      <div className="provider-accounts">
        <p className="provider-account">
          状态：<span style={{ color: quota.status === 'ok' ? 'var(--accent)' : 'var(--warning)', fontWeight: 600 }}>正常同步</span>
          {quota.plan && <span className="provider-tag" style={{ marginLeft: '8px' }}>{quota.plan}</span>}
        </p>
      </div>

      <div className="quota-groups">
        <section className="quota-group">
          <div className="gauge">
            {allWindows.map((win, idx) => (
              <BatteryRow key={idx} window={win} pc={visuals.pc} />
            ))}
            {allWindows.length === 0 && (
              <p className="hint" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '24px 0' }}>
                暂无配额窗口数据
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="provider-foot" style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid var(--glass-edge)', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
        <span>更新于 {new Date(quota.capturedAt).toLocaleTimeString()}</span>
        <span>官方读数</span>
      </div>
    </article>
  );
};
