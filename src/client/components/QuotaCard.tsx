import React, { useId } from 'react';
import type { AccountType, ProviderQuota, QuotaWindow } from '../types';
import { collectQuotaWindows } from '../lib/quota';
import { formatCompactDuration } from '../lib/format';
import { useNow } from '../lib/useNow';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

export interface BatteryThresholds {
  warning: number;
  low: number;
}

/** Drag-and-drop and keyboard reordering; the parent owns the order. */
export interface CardReorder {
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onMove: (delta: -1 | 1) => void;
}

interface QuotaCardProps {
  quota: ProviderQuota;
  includeAgyClaude?: boolean;
  thresholds: BatteryThresholds;
  reorder?: CardReorder;
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

/*
 * Liquid surface for the battery cell, in a 100×100 box stretched over the tank. Two 50-unit wave periods repeat out
 * to x=200 so the path can slide left by one period forever without showing an edge.
 */
const WAVE_FRONT = 'M0 0 Q12.5 -3.2 25 0 T50 0 T75 0 T100 0 T125 0 T150 0 T175 0 T200 0 V120 H0 Z';
/** The bright meniscus line along the front wave's crest (open path, so no edges are stroked). */
const WAVE_CREST = 'M0 0 Q12.5 -3.2 25 0 T50 0 T75 0 T100 0 T125 0 T150 0 T175 0 T200 0';
const WAVE_BACK = 'M0 -1.6 Q12.5 1.8 25 -1.6 T50 -1.6 T75 -1.6 T100 -1.6 T125 -1.6 T150 -1.6 T175 -1.6 T200 -1.6 V120 H0 Z';

/**
 * Quota window as a glass battery cell: a frosted tube with a terminal cap, a liquid level with two drifting waves,
 * cylindrical gloss on top and a soft glow under the liquid. The level fills up from empty on first paint.
 */
const Battery: React.FC<{ window: QuotaWindow; thresholds: BatteryThresholds; now: number }> = ({ window: win, thresholds, now }) => {
  const { t, locale } = useI18n();
  const gradId = `lq-${useId().replace(/:/g, '')}`;
  const known = Number.isFinite(win.remainingPercent);
  const percent = known ? Math.min(100, Math.max(0, win.remainingPercent)) : 0;
  const level = !known ? 'unknown' : percent <= thresholds.low ? 'low' : percent <= thresholds.warning ? 'warning' : 'normal';
  const label = windowLabel(win.label, t);
  const countdown = win.resetAt ? formatCompactDuration(win.resetAt - now) : '';
  const value = known ? `${Math.round(percent)}%` : t('quota.unknown');
  return (
    <div className="gauge-row" data-level={level} style={{ '--v': percent } as React.CSSProperties}>
      <span className="gauge-label" title={label}>{label}</span>
      <div className="cell-stage">
        <div className="cell" role="img" aria-label={t('quota.remaining', { label, value })}>
          <span className="cell-cap" aria-hidden="true" />
          <span className="cell-tank" aria-hidden="true">
            {known && percent > 0 && (
              <svg className="cell-liquid" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop className="lq-top" offset="0" />
                    <stop className="lq-bottom" offset="0.7" />
                  </linearGradient>
                </defs>
                <g className="cell-level" style={{ '--lvl': `${100 - percent}px` } as React.CSSProperties}>
                  <path className="wave-back" d={WAVE_BACK} />
                  <g className="wave-front">
                    <path d={WAVE_FRONT} fill={`url(#${gradId})`} />
                    <path className="wave-crest" d={WAVE_CREST} />
                  </g>
                </g>
              </svg>
            )}
            <span className="cell-ticks" />
            <span className="cell-gloss" />
          </span>
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

export const QuotaCard: React.FC<QuotaCardProps> = ({
  quota,
  includeAgyClaude = false,
  thresholds,
  reorder,
  onEdit,
  onSignIn,
  onRetry,
}) => {
  const { t, locale } = useI18n();
  const now = useNow();
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
  const ago = quota.capturedAt ? formatCompactDuration(now - quota.capturedAt) : '';
  const text = message ? `${message}${quota.stale ? t('quota.staleAgo', { ago }) : ''}` : '';
  const canSignIn = quota.accountType && quota.accountType !== 'agy' && onSignIn;
  const needsSignIn = canSignIn && (quota.errorCode === 'login_required' || quota.errorCode === 'login_expired');
  const canRetry = onRetry && (quota.errorCode === 'read_failed' || quota.errorCode === 'offline') && windows.length === 0;
  const tone = loading || quota.status === 'unconfigured' ? 'info' : quota.status === 'error' ? 'danger' : undefined;

  return (
    <article
      className="panel provider-card"
      style={{ '--pc': visuals.pc } as React.CSSProperties}
      data-dragging={reorder?.dragging || undefined}
      data-drop-target={reorder?.dropTarget || undefined}
      draggable={Boolean(reorder)}
      onDragStart={reorder ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', quota.accountCardId || ''); reorder.onDragStart(); } : undefined}
      onDragOver={reorder ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; reorder.onDragOver(); } : undefined}
      onDrop={reorder ? (event) => { event.preventDefault(); reorder.onDrop(); } : undefined}
      onDragEnd={reorder ? reorder.onDragEnd : undefined}
    >
      <header className="provider-heading">
        {reorder ? (
          <button
            type="button"
            className="provider-icon is-grip"
            title={t('quota.move')}
            aria-label={`${quota.displayName}: ${t('quota.move')}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); reorder.onMove(-1); }
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); reorder.onMove(1); }
            }}
          >
            {visuals.icon}
          </button>
        ) : (
          <span className="provider-icon" aria-hidden="true">{visuals.icon}</span>
        )}
        <div className="provider-title">
          <h3 title={quota.displayName}>{quota.displayName}</h3>
          <p title={subtitle}>{subtitle || t('quota.official')}</p>
        </div>
        <div className="card-tools">
          {onEdit && quota.accountCardId && (
            <button type="button" className="tool-circle" aria-label={t('quota.edit')} title={t('quota.edit')} onClick={() => onEdit(quota)}>
              <Icon name="edit" size={13} />
            </button>
          )}
          <span className="tool-circle" role="img" aria-label={statusLabel} title={statusLabel}>
            <i className="status-dot" data-status={quota.status} />
          </span>
        </div>
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
            {windows.map((win, idx) => <Battery key={`${win.label}-${idx}`} window={win} thresholds={thresholds} now={now} />)}
          </div>
        )}
        {windows.length === 0 && !text && <p className="hint">{t('quota.noData')}</p>}
      </div>
    </article>
  );
};
