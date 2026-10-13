import React from 'react';
import type { AccountType, ProviderQuota, QuotaWindow } from '../types';
import { collectQuotaWindows } from '../lib/quota';
import { formatCompactDuration } from '../lib/format';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export interface BatteryThresholds {
  warning: number;
  low: number;
}

interface QuotaCardProps {
  quota: ProviderQuota;
  includeAgyClaude?: boolean;
  thresholds: BatteryThresholds;
  onEdit?: (quota: ProviderQuota) => void;
  onSignIn?: (type: AccountType) => void;
  onRetry?: () => void;
}

type Translate = ReturnType<typeof useI18n>['t'];

function providerVisuals(provider: string) {
  const p = provider.toLowerCase();
  if (p.includes('codex') || p.includes('openai')) return { pc: 'var(--p-codex)', icon: 'O' };
  if (p.includes('claude') || p.includes('anthropic')) return { pc: 'var(--p-claude)', icon: 'C' };
  if (p.includes('grok') || p.includes('xai')) return { pc: 'var(--p-grok)', icon: 'G' };
  if (p.includes('antigravity') || p.includes('gemini') || p.includes('google')) return { pc: 'var(--p-agy)', icon: 'A' };
  return { pc: 'var(--accent)', icon: '•' };
}

/** Window labels arrive in several spellings (pi, OpenAI, Claude, older stored readings); show one per language. */
function windowLabel(label: string, t: Translate): string {
  const text = label.trim();
  if (/5\s*-?\s*hour|five\s*hour|5\s*小时/i.test(text) || text === 'primary') return t('win.5h');
  if (/week|每周/i.test(text) || text === 'secondary') {
    const model = text.replace(/\s*(weekly|week|每周)(\s*(limit|credit|window))?(\s*remaining)?\s*$/i, '').trim();
    return model ? t('win.weekModel', { model }) : t('win.week');
  }
  return text.replace(/ Limit Remaining$/i, '').replace(/ limit/i, '');
}

const Battery: React.FC<{ window: QuotaWindow; thresholds: BatteryThresholds }> = ({ window: win, thresholds }) => {
  const { t, locale } = useI18n();
  const known = Number.isFinite(win.remainingPercent);
  const percent = known ? Math.min(100, Math.max(0, win.remainingPercent)) : 0;
  const level = !known ? 'unknown' : percent <= thresholds.low ? 'low' : percent <= thresholds.warning ? 'warning' : 'normal';
  const label = windowLabel(win.label, t);
  const countdown = win.resetAt ? formatCompactDuration(win.resetAt - Date.now()) : '';
  const value = known ? `${Math.round(percent)}%` : t('quota.unknown');
  return (
    <div className="gauge-row" data-level={level} style={{ '--v': percent } as React.CSSProperties}>
      <span className="gauge-label" title={label}>{label}</span>
      <div className="battery-stage">
        <div className="battery" role="img" aria-label={t('quota.remaining', { label, value })}>
          <i className="battery-fill" style={{ height: `${percent}%` }} />
        </div>
      </div>
      <span className="gauge-val">{known ? Math.round(percent) : '—'}{known && <small>%</small>}</span>
      <span className="gauge-reset" title={win.resetAt ? t('quota.resetAt', { time: new Date(win.resetAt).toLocaleString(locale) }) : undefined}>
        <Icon name="refresh" size={10} />
        {countdown || t('quota.cycleReset')}
      </span>
    </div>
  );
};

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota, includeAgyClaude = false, thresholds, onEdit, onSignIn, onRetry }) => {
  const { t, locale } = useI18n();
  const visuals = providerVisuals(quota.provider);
  const { windows, groupLabel, hiddenClaude } = collectQuotaWindows(quota, includeAgyClaude);
  const subtitle = [quota.email, quota.plan, groupLabel, hiddenClaude ? t('quota.hiddenClaude') : '']
    .filter(Boolean)
    .join(' · ');
  const statusLabel = t(`quota.status.${quota.status}`);

  const loading = quota.status === 'loading';
  const code = quota.errorCode === 'agy_unavailable' ? undefined : quota.errorCode;
  const message = loading
    ? t('quota.loading')
    : quota.errorCode === 'agy_unavailable'
      ? t('err.agyLocal')
      : code
        ? t(`err.${code}`, { detail: quota.errorMessage || '' })
        : quota.errorMessage;
  const ago = quota.capturedAt ? formatCompactDuration(Date.now() - quota.capturedAt) : '';
  const text = message ? `${message}${quota.stale ? t('quota.staleAgo', { ago }) : ''}` : '';
  const canSignIn = quota.accountType && quota.accountType !== 'agy' && onSignIn;
  const needsSignIn = canSignIn && (quota.errorCode === 'login_required' || quota.errorCode === 'login_expired');
  const canRetry = onRetry && (quota.errorCode === 'read_failed' || quota.errorCode === 'offline') && windows.length === 0;
  const tone = loading || quota.status === 'unconfigured' ? 'info' : quota.status === 'error' ? 'danger' : undefined;

  return (
    <article className="panel provider-card" style={{ '--pc': visuals.pc } as React.CSSProperties}>
      <header className="provider-heading">
        <span className="provider-icon" aria-hidden="true">{visuals.icon}</span>
        <div className="provider-title">
          <h3 title={quota.displayName}>{quota.displayName}</h3>
          <p title={subtitle}>{subtitle || t('quota.official')}</p>
        </div>
        <span className="status-dot" data-status={quota.status} role="img" aria-label={statusLabel} title={statusLabel} />
      </header>

      <div className="quota-body">
        {text && (
          <div className="callout" data-tone={tone} role={loading ? 'status' : undefined}>
            {loading
              ? <Icon name="refresh" size={15} className="is-spinning" />
              : <Icon name={tone === 'info' ? 'info' : 'alert'} size={15} />}
            <span>{text}</span>
          </div>
        )}
        {needsSignIn && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onSignIn!(quota.accountType!)}>
            {quota.errorCode === 'login_expired' ? t('quota.reSignIn') : t('quota.signIn')}
          </button>
        )}
        {canRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>{t('quota.retry')}</button>
        )}
        {windows.length > 0 && (
          <div
            className="gauge"
            data-stale={quota.stale ? 'true' : undefined}
            data-count={windows.length}
            style={{ '--cols': windows.length === 4 ? 2 : Math.min(windows.length, 3) } as React.CSSProperties}
          >
            {windows.map((win, idx) => <Battery key={`${win.label}-${idx}`} window={win} thresholds={thresholds} />)}
          </div>
        )}
        {windows.length === 0 && !text && <p className="hint">{t('quota.noData')}</p>}
      </div>

      <footer className="provider-foot">
        <span>{quota.capturedAt ? t('quota.readAt', { time: new Date(quota.capturedAt).toLocaleTimeString(locale) }) : loading ? '—' : t('quota.noReading')}</span>
        {onEdit && quota.accountCardId && (
          <span className="actions">
            <button type="button" className="text-link" onClick={() => onEdit(quota)}>{t('quota.edit')}</button>
          </span>
        )}
      </footer>
    </article>
  );
};
