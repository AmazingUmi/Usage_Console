import React, { useState } from 'react';
import type { UsageSummary, DailyTrendPoint, GroupedUsage } from '../types';
import { formatCnyFromUsd, formatTokens, formatUsd } from '../lib/format';
import { useI18n } from '../i18n';
import { UsageTrendChart, seriesFor } from './UsageTrendChart';
import type { TrendMetric } from './UsageTrendChart';

interface OverviewDashboardProps {
  summary: UsageSummary;
  trend: DailyTrendPoint[];
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
}

type Dimension = 'client' | 'model' | 'provider';

const DIMENSIONS: Array<{ id: Dimension; key: string }> = [
  { id: 'client', key: 'dist.client' },
  { id: 'model', key: 'dist.model' },
  { id: 'provider', key: 'dist.provider' },
];

const MAX_ROWS = 8;

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ summary, trend, models, providers, clients }) => {
  const { t, locale } = useI18n();
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const [dimension, setDimension] = useState<Dimension>('client');

  const lists: Record<Dimension, GroupedUsage[]> = { client: clients, model: models, provider: providers };
  const pick = (item: GroupedUsage) => (metric === 'cost' ? item.estimatedCostUsd || 0 : item.totalTokens || 0);
  const sorted = [...lists[dimension]].sort((a, b) => pick(b) - pick(a));
  const total = sorted.reduce((sum, item) => sum + pick(item), 0);
  const rows = sorted.slice(0, MAX_ROWS).map((item) => ({ name: item.name, value: pick(item) }));
  if (sorted.length > MAX_ROWS) {
    rows.push({ name: t('dist.others', { n: sorted.length - MAX_ROWS }), value: sorted.slice(MAX_ROWS).reduce((sum, item) => sum + pick(item), 0) });
  }
  const maxRow = Math.max(1, ...rows.map((row) => row.value));
  const fmt = (n: number) => (metric === 'cost' ? formatUsd(n, 2) : formatTokens(n));

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
            <div>
              <h3 id="trend-title">{t('trend.title')}</h3>
              <p className="hint">{t('trend.hint', { n: trend.length })}</p>
            </div>
            <div className="segmented" role="group" aria-label={t('trend.metric')}>
              <button type="button" aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Token</button>
              <button type="button" aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>{t('trend.cost')}</button>
            </div>
          </div>
          <div className="chart-body">
            {seriesFor(metric).length > 1 && (
              <div className="chart-legend">
                {seriesFor(metric).map((s) => (
                  <span key={s.key}><i style={{ background: s.color }} />{t(s.labelKey)}</span>
                ))}
              </div>
            )}
            <UsageTrendChart trend={trend} metric={metric} />
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
            <span>{t('dist.total', { metric: metric === 'cost' ? t('trend.cost') : 'Token' })}</span>
            <strong>{fmt(total)}</strong>
          </div>
          <ol className="breakdown-list">
            {rows.map((row) => {
              const pct = total > 0 ? (row.value / total) * 100 : 0;
              return (
                <li key={row.name} className="breakdown-item">
                  <div className="breakdown-row">
                    <span className="breakdown-name" title={row.name}>{row.name}</span>
                    <span className="breakdown-value">{fmt(row.value)}</span>
                    <span className="breakdown-pct">{pct.toFixed(pct >= 10 ? 0 : 1)}%</span>
                  </div>
                  <div className="breakdown-track"><span style={{ width: `${(row.value / maxRow) * 100}%` }} /></div>
                </li>
              );
            })}
            {rows.length === 0 && <li className="empty">{t('dist.none')}</li>}
          </ol>
        </aside>
      </div>
    </>
  );
};
