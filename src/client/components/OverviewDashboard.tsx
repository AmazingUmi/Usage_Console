import React, { useMemo, useState } from 'react';
import type { UsageSummary, DailyTrendPoint, GroupedUsage, UsageRange } from '../types';
import { formatCnyFromUsd, formatTokens, formatUsd } from '../lib/format';
import { UsageTrendChart } from './UsageTrendChart';

interface OverviewDashboardProps {
  summary: UsageSummary;
  trend: DailyTrendPoint[];
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
  range: UsageRange;
  onRangeChange: (r: UsageRange) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  summary,
  trend,
  models,
  providers,
  clients,
  range,
  onRangeChange,
}) => {
  const [comparisonMetric, setComparisonMetric] = useState<'cost' | 'tokens'>('tokens');
  const [comparisonDimension, setComparisonDimension] = useState<'client' | 'model' | 'provider'>('client');
  const [chartMode, setChartMode] = useState<'bar' | 'line'>('line');
  const [hoveredPoint, setHoveredPoint] = useState<DailyTrendPoint | null>(null);

  const currentList = comparisonDimension === 'client'
    ? clients
    : comparisonDimension === 'provider'
      ? providers
      : models;

  const maxVal = Math.max(
    1,
    ...currentList.map((item) => (comparisonMetric === 'cost' ? item.estimatedCostUsd : item.totalTokens)),
  );

  const totalSum = currentList.reduce(
    (acc, item) => acc + (comparisonMetric === 'cost' ? item.estimatedCostUsd || 0 : item.totalTokens || 0),
    0,
  );

  const avgTokens = summary.requestCount > 0 ? Math.round(summary.totalTokens / summary.requestCount) : 0;
  const trendLabel = trend.length > 0 ? `${trend.length} 天` : '近期';
  const maxTrendTokens = Math.max(1000, ...trend.map((point) => point.totalTokens || 0));
  const axisLabels = useMemo(() => {
    if (trend.length === 0) return [];
    return [trend[0], trend[Math.floor(trend.length / 2)], trend[trend.length - 1]];
  }, [trend]);

  return (
    <div className="dash-row">
      <div className="panel usage-panel">
        <div className="overview-card-header">
          <div className="stat-row">
            <div className="stat">
              <div className="stat-label">
                累计 Tokens
                <details className="info-help">
                  <summary aria-label="Token 统计说明">?</summary>
                  <div className="help-content">
                    <strong>Token 统计说明</strong>
                    <p>统计当前时间范围内本机开发客户端产生的输入输出 Token 总和，包含 Antigravity 的 Claude 模型。</p>
                  </div>
                </details>
              </div>
              <strong id="overview-tokens">{formatTokens(summary.totalTokens)}</strong>
              <small>输入 {formatTokens(summary.inputTokens)} · 输出 {formatTokens(summary.outputTokens)}</small>
            </div>

            <div className="stat">
              <div className="stat-label">
                估算费用 <span className="unit">USD</span>
                <details className="info-help">
                  <summary aria-label="费用估算说明">?</summary>
                  <div className="help-content">
                    <strong>费用估算说明</strong>
                    <p>依照各模型官方 API 标价计算的理论费用，非实际订阅账单扣费。</p>
                  </div>
                </details>
              </div>
              <strong id="overview-cost">{formatUsd(summary.estimatedCostUsd)}</strong>
              <small>折合约 {formatCnyFromUsd(summary.estimatedCostUsd)} CNY</small>
            </div>

            <div className="stat">
              <div className="stat-label">请求调用量</div>
              <strong>{(summary.requestCount || 0).toLocaleString()} <span className="unit">次</span></strong>
              <small>平均: {formatTokens(avgTokens)}/次</small>
            </div>

            <div className="stat">
              <div className="stat-label">缓存命中与推理</div>
              <strong>{formatTokens(summary.cacheReadTokens)}</strong>
              <small>
                推理 {formatTokens(summary.reasoningTokens)} · 写入 {formatTokens(summary.cacheWriteTokens)}
              </small>
            </div>
          </div>

        </div>

        <div className="chart-heading">
          <div className="title-row">
            <h3>Token 消耗趋势（{trendLabel}）</h3>
            <details className="info-help">
              <summary aria-label="消耗趋势说明">?</summary>
              <div className="help-content">
                <strong>消耗趋势说明</strong>
                <p>可在柱状图和折线图之间切换。折线图按日展示输入、输出、缓存和估算费用，费用使用右侧坐标。</p>
              </div>
            </details>
          </div>
        </div>

        <div className="overview-toolbar">
          <div className="comparison-tabs" role="group" aria-label="图表类型">
            <button
              type="button"
              className={`comparison-tab-btn${chartMode === 'bar' ? ' active' : ''}`}
              aria-pressed={chartMode === 'bar'}
              onClick={() => setChartMode('bar')}
            >
              柱状图
            </button>
            <button
              type="button"
              className={`comparison-tab-btn${chartMode === 'line' ? ' active' : ''}`}
              aria-pressed={chartMode === 'line'}
              onClick={() => setChartMode('line')}
            >
              折线图
            </button>
          </div>
          <div className="ledger-filter">
            <label htmlFor="range-select">统计范围</label>
            <select
              id="range-select"
              value={range}
              onChange={(e) => onRangeChange(e.target.value as UsageRange)}
            >
              <option value="today">今日用量</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="all">总体用量 (全部)</option>
            </select>
          </div>
        </div>

        {chartMode === 'line' ? (
          <UsageTrendChart trend={trend} />
        ) : (
          <div className="trend-chart" onMouseLeave={() => setHoveredPoint(null)}>
            {hoveredPoint && (
              <div className="trend-tooltip" role="status">
                <strong>{hoveredPoint.date}</strong>
                <span>{formatTokens(hoveredPoint.totalTokens)} tokens</span>
                <span>{formatUsd(hoveredPoint.estimatedCostUsd, 2)}</span>
                <span>{hoveredPoint.requestCount || 0} 次</span>
              </div>
            )}
            {trend.map((point) => {
              const h = Math.max(4, ((point.totalTokens || 0) / maxTrendTokens) * 100);
              const isHovered = hoveredPoint?.date === point.date;
              return (
                <div key={point.date} className="trend-col" onMouseEnter={() => setHoveredPoint(point)}>
                  <div
                    className={`trend-bar${isHovered ? ' is-hovered' : ''}${(point.totalTokens || 0) > 0 ? '' : ' is-empty'}`}
                    style={{ height: `${Number.isFinite(h) ? h : 4}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {chartMode === 'bar' && (
          <div className="trend-axis">
            {axisLabels.map((point, index) => (
              <span key={`${point.date}-${index}`}>{point.date}</span>
            ))}
          </div>
        )}
      </div>

      <aside className="panel side-panel" aria-label="用量分布对比">
        <section className="model-comparison" aria-labelledby="model-comparison-title">
          <div className="title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 id="model-comparison-title" style={{ fontSize: '15px', fontWeight: 650 }}>
              用量对比分布
            </h3>
            <details className="info-help">
              <summary aria-label="用量对比说明">?</summary>
              <div className="help-content">
                <strong>用量对比说明</strong>
                <p>可按「软件客户端」、「模型」或「服务商渠道」切换对比，长条按最大值归一化展示。</p>
              </div>
            </details>
          </div>

          <div className="comparison-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <div className="comparison-tabs">
                <button
                  type="button"
                  className={`comparison-tab-btn ${comparisonDimension === 'client' ? 'active' : ''}`}
                  onClick={() => setComparisonDimension('client')}
                >
                  按软件 ({clients.length})
                </button>
                <button
                  type="button"
                  className={`comparison-tab-btn ${comparisonDimension === 'model' ? 'active' : ''}`}
                  onClick={() => setComparisonDimension('model')}
                >
                  按模型 ({models.length})
                </button>
                <button
                  type="button"
                  className={`comparison-tab-btn ${comparisonDimension === 'provider' ? 'active' : ''}`}
                  onClick={() => setComparisonDimension('provider')}
                >
                  按渠道 ({providers.length})
                </button>
              </div>

              <div className="comparison-tabs">
                <button
                  type="button"
                  className={`comparison-tab-btn ${comparisonMetric === 'tokens' ? 'active' : ''}`}
                  onClick={() => setComparisonMetric('tokens')}
                >
                  Token
                </button>
                <button
                  type="button"
                  className={`comparison-tab-btn ${comparisonMetric === 'cost' ? 'active' : ''}`}
                  onClick={() => setComparisonMetric('cost')}
                >
                  金额
                </button>
              </div>
            </div>
          </div>

          <div className="comparison-total">
            <span>合计</span>
            <strong id="model-comparison-total">
              {comparisonMetric === 'cost' ? formatUsd(totalSum) : formatTokens(totalSum)}
            </strong>
            <span id="model-comparison-unit">{comparisonMetric === 'cost' ? 'USD' : 'Tokens'}</span>
          </div>

          <ol className="comparison-list" tabIndex={0}>
            {currentList.map((item) => {
              const val = comparisonMetric === 'cost' ? item.estimatedCostUsd || 0 : item.totalTokens || 0;
              const fillPercent = Math.max(3, (val / maxVal) * 100);

              return (
                <li key={item.name} className="comparison-item">
                  <div className="comparison-item-heading">
                    <span className="comparison-model-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="comparison-model-value">
                      {comparisonMetric === 'cost' ? formatUsd(item.estimatedCostUsd) : formatTokens(item.totalTokens)}
                      <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '6px' }}>({item.percentage || 0}%)</span>
                    </span>
                  </div>
                  <div className="comparison-track">
                    <span style={{ width: `${Number.isFinite(fillPercent) ? fillPercent : 0}%` }}></span>
                  </div>
                </li>
              );
            })}
            {currentList.length === 0 && (
              <p className="comparison-empty">此区间暂无用量记录</p>
            )}
          </ol>
        </section>
      </aside>
    </div>
  );
};
