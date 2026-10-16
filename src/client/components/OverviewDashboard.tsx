import React, { useState } from 'react';
import type { UsageSummary, DailyTrendPoint, GroupedUsage, SpeedReport } from '../types';
import { formatCnyFromUsd, formatMillis, formatTokPerSec, formatTokens, formatUsd } from '../lib/format';
import { useI18n } from '../i18n';
import { HelpTip } from './HelpTip';
import type { TrendKind } from './UsageTrendChart';
import { UsageTrendChart, seriesFor } from './UsageTrendChart';
import type { TrendMetric } from './UsageTrendChart';

interface OverviewDashboardProps {
  summary: UsageSummary;
  trend: DailyTrendPoint[];
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
  speed: SpeedReport | null;
}

type Dimension = 'client' | 'model' | 'provider';

const DIMENSIONS: Array<{ id: Dimension; key: string }> = [
  { id: 'client', key: 'dist.client' },
  { id: 'model', key: 'dist.model' },
  { id: 'provider', key: 'dist.provider' },
];

const MAX_ROWS = 8;
const KIND_KEY = 'usage-console-trend-kind';

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ summary, trend, models, providers, clients, speed }) => {
  const { t, locale } = useI18n();
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggleSeries = (key: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const [kind, setKindState] = useState<TrendKind>(() => {
    try {
      return window.localStorage.getItem(KIND_KEY) === 'line' ? 'line' : 'bar';
    } catch {
      return 'bar';
    }
  });
  const setKind = (next: TrendKind) => {
    setKindState(next);
    try {
      window.localStorage.setItem(KIND_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  };
  const [dimension, setDimension] = useState<Dimension>('client');

  const lists: Record<Dimension, GroupedUsage[]> = { client: clients, model: models, provider: providers };
  const speedMode = metric === 'speed';
  const pick = (item: GroupedUsage) => {
    if (metric === 'cost') return item.estimatedCostUsd || 0;
    if (speedMode) return item.tokensPerSecondMedian || 0;
    return item.totalTokens || 0;
  };
  const source = speedMode ? lists[dimension].filter((item) => (item.speedSamples ?? 0) > 0) : lists[dimension];
  const sorted = [...source].sort((a, b) => pick(b) - pick(a));
  const total = sorted.reduce((sum, item) => sum + pick(item), 0);
  const rows = sorted.slice(0, MAX_ROWS).map((item) => ({
    name: item.name,
    value: pick(item),
    ttft: item.ttftMedianMs,
    samples: item.speedSamples ?? 0,
  }));
  const overflow = sorted.length > MAX_ROWS ? sorted.length - MAX_ROWS : 0;
  if (!speedMode && overflow > 0) {
    rows.push({ name: t('dist.others', { n: overflow }), value: sorted.slice(MAX_ROWS).reduce((sum, item) => sum + pick(item), 0), ttft: null, samples: 0 });
  }
  const maxRow = Math.max(1, ...rows.map((row) => row.value));
  const fmt = (n: number) => (metric === 'cost' ? formatUsd(n, 2) : speedMode ? t('speed.perSec', { n: formatTokPerSec(n, locale) }) : formatTokens(n));
  const speedTotal = speed?.tokensPerSecondMedian;

  const avgTokens = summary.requestCount > 0 ? Math.round(summary.totalTokens / summary.requestCount) : 0;
  const cacheBase = summary.cacheReadTokens + summary.inputTokens + summary.cacheWriteTokens;
  const cacheRate = cacheBase > 0 ? (summary.cacheReadTokens / cacheBase) * 100 : 0;

  return (
    <>
      <div className="stat-grid">
        <div className="panel stat">
          <div className="stat-label">{t('stat.tokens')}</div>
          <div className="stat-value">{formatTokens(summary.totalTokens)}</div>
          <div className="stat-sub">{t('stat.tokensSub', { input: formatTokens(summary.inputTokens), output: formatTokens(summary.outputTokens) })}</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">{t('stat.cost')}</div>
          <div className="stat-value">{formatUsd(summary.estimatedCostUsd, 2)}</div>
          <div className="stat-sub">{t('stat.costSub', { cny: formatCnyFromUsd(summary.estimatedCostUsd) })}</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">{t('stat.requests')}</div>
          <div className="stat-value">{(summary.requestCount || 0).toLocaleString(locale)}</div>
          <div className="stat-sub">{t('stat.requestsSub', { avg: formatTokens(avgTokens) })}</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">{t('stat.cache')}</div>
          <div className="stat-value">{formatTokens(summary.cacheReadTokens)}</div>
          <div className="stat-sub">{t('stat.cacheSub', { rate: cacheRate.toFixed(0), write: formatTokens(summary.cacheWriteTokens) })}</div>
        </div>
      </div>

      <div className="dash-row">
        <section className="panel" aria-labelledby="trend-title">
          <div className="panel-head">
            <div className="title-row">
              <h3 id="trend-title">{t('trend.title')}</h3>
              <HelpTip text={t(metric === 'speed' ? 'trend.hint.speed' : 'trend.hint', { n: trend.length })} />
            </div>
            <div className="row-wrap">
              <div className="segmented" role="group" aria-label={t('trend.kind')}>
                <button type="button" aria-pressed={kind === 'bar'} onClick={() => setKind('bar')}>{t('trend.kind.bar')}</button>
                <button type="button" aria-pressed={kind === 'line'} onClick={() => setKind('line')}>{t('trend.kind.line')}</button>
              </div>
              <div className="segmented" role="group" aria-label={t('trend.metric')}>
                <button type="button" aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Token</button>
                <button type="button" aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>{t('trend.cost')}</button>
                <button type="button" aria-pressed={metric === 'speed'} onClick={() => setMetric('speed')}>{t('trend.speed')}</button>
              </div>
            </div>
          </div>
          <div className="chart-body">
            <div className="chart-legend">
              {seriesFor(metric, kind).length > 1 && seriesFor(metric, kind).map((s) => (
                kind === 'line' || metric === 'speed' ? (
                  <button
                    key={s.key}
                    type="button"
                    className="legend-toggle"
                    aria-pressed={!hidden.has(s.key)}
                    title={t('trend.legendToggle')}
                    onClick={() => toggleSeries(s.key)}
                  >
                    <i style={{ background: s.color }} />{t(s.labelKey)}
                  </button>
                ) : (
                  <span key={s.key}><i style={{ background: s.color }} />{t(s.labelKey)}</span>
                )
              ))}
            </div>
            <UsageTrendChart trend={trend} metric={metric} kind={kind} hidden={hidden} />
          </div>
        </section>

        <aside className="panel breakdown" aria-labelledby="breakdown-title">
          <div className="panel-head">
            <h3 id="breakdown-title">{t('dist.title')}</h3>
            <div className="segmented" role="group" aria-label={t('dist.aria')}>
              {DIMENSIONS.map((item) => (
                <button key={item.id} type="button" aria-pressed={dimension === item.id} onClick={() => setDimension(item.id)}>
                  {t(item.key)}<span className="count">{lists[item.id].length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="breakdown-total">
            <span>{speedMode
              ? t('dist.median', { metric: t('speed.output') })
              : t('dist.total', { metric: metric === 'cost' ? t('trend.cost') : 'Token' })}</span>
            <strong>{speedMode ? (speedTotal == null ? '—' : t('speed.perSec', { n: formatTokPerSec(speedTotal, locale) })) : fmt(total)}</strong>
          </div>
          <ol className="breakdown-list">
            {rows.map((row) => {
              const pct = total > 0 ? (row.value / total) * 100 : 0;
              return (
                <li key={row.name} className="breakdown-item">
                  <div className="breakdown-row">
                    <span className="breakdown-name" title={row.name}>{row.name}</span>
                    <span className="breakdown-value">{fmt(row.value)}</span>
                    <span className="breakdown-pct" title={speedMode ? t('speed.ttft') : undefined}>{speedMode ? formatMillis(row.ttft) : `${pct.toFixed(pct >= 10 ? 0 : 1)}%`}</span>
                  </div>
                  <div className="breakdown-track"><span style={{ width: `${(row.value / maxRow) * 100}%` }} /></div>
                </li>
              );
            })}
            {speedMode && overflow > 0 && <li className="breakdown-more">{t('dist.others', { n: overflow })}</li>}
            {rows.length === 0 && <li className="empty">{t(speedMode ? 'dist.none.speed' : 'dist.none')}</li>}
          </ol>
        </aside>
      </div>
    </>
  );
};
