import React, { useState } from 'react';
import type { UsageSummary, DailyTrendPoint, GroupedUsage } from '../types';
import { formatCnyFromUsd, formatTokens, formatUsd } from '../lib/format';
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

const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'client', label: '软件' },
  { id: 'model', label: '模型' },
  { id: 'provider', label: '渠道' },
];

const MAX_ROWS = 8;

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ summary, trend, models, providers, clients }) => {
  const [metric, setMetric] = useState<TrendMetric>('tokens');
  const [dimension, setDimension] = useState<Dimension>('client');

  const lists: Record<Dimension, GroupedUsage[]> = { client: clients, model: models, provider: providers };
  const pick = (item: GroupedUsage) => (metric === 'cost' ? item.estimatedCostUsd || 0 : item.totalTokens || 0);
  const sorted = [...lists[dimension]].sort((a, b) => pick(b) - pick(a));
  const total = sorted.reduce((sum, item) => sum + pick(item), 0);
  const rows = sorted.slice(0, MAX_ROWS).map((item) => ({ name: item.name, value: pick(item) }));
  if (sorted.length > MAX_ROWS) {
    rows.push({ name: `其他 ${sorted.length - MAX_ROWS} 项`, value: sorted.slice(MAX_ROWS).reduce((sum, item) => sum + pick(item), 0) });
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
          <div className="stat-label">Tokens（输入 + 输出）</div>
          <div className="stat-value">{formatTokens(summary.totalTokens)}</div>
          <div className="stat-sub">输入 {formatTokens(summary.inputTokens)} · 输出 {formatTokens(summary.outputTokens)}</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">估算费用</div>
          <div className="stat-value">{formatUsd(summary.estimatedCostUsd, 2)}</div>
          <div className="stat-sub">约 {formatCnyFromUsd(summary.estimatedCostUsd)} · 按 API 标价折算</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">请求次数</div>
          <div className="stat-value">{(summary.requestCount || 0).toLocaleString()}</div>
          <div className="stat-sub">平均 {formatTokens(avgTokens)} / 次</div>
        </div>
        <div className="panel stat">
          <div className="stat-label">缓存命中</div>
          <div className="stat-value">{formatTokens(summary.cacheReadTokens)}</div>
          <div className="stat-sub">命中率 {cacheRate.toFixed(0)}% · 写入 {formatTokens(summary.cacheWriteTokens)}</div>
        </div>
      </div>

      <div className="dash-row">
        <section className="panel" aria-labelledby="trend-title">
          <div className="panel-head">
            <div>
              <h3 id="trend-title">每日趋势</h3>
              <p className="hint">近 {trend.length} 天，悬停查看缓存与请求明细</p>
            </div>
            <div className="segmented" role="group" aria-label="趋势指标">
              <button type="button" aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Token</button>
              <button type="button" aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>费用</button>
            </div>
          </div>
          <div className="chart-body">
            {seriesFor(metric).length > 1 && (
              <div className="chart-legend">
                {seriesFor(metric).map((s) => (
                  <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
                ))}
              </div>
            )}
            <UsageTrendChart trend={trend} metric={metric} />
          </div>
        </section>

        <aside className="panel breakdown" aria-labelledby="breakdown-title">
          <div className="panel-head">
            <h3 id="breakdown-title">分布</h3>
            <div className="segmented" role="group" aria-label="分布维度">
              {DIMENSIONS.map((item) => (
                <button key={item.id} type="button" aria-pressed={dimension === item.id} onClick={() => setDimension(item.id)}>
                  {item.label}<span className="count">{lists[item.id].length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="breakdown-total">
            <span>合计（{metric === 'cost' ? '费用' : 'Token'}）</span>
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
            {rows.length === 0 && <li className="empty">此区间暂无用量记录</li>}
          </ol>
        </aside>
      </div>
    </>
  );
};
