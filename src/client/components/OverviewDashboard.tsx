import React, { useState } from 'react';
import type { UsageSummary, DailyTrendPoint, GroupedUsage, UsageRange } from '../types';

interface OverviewDashboardProps {
  summary: UsageSummary;
  trend: DailyTrendPoint[];
  models: GroupedUsage[];
  providers: GroupedUsage[];
  clients: GroupedUsage[];
  range: UsageRange;
  onRangeChange: (r: UsageRange) => void;
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
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
  const [hoveredPoint, setHoveredPoint] = useState<DailyTrendPoint | null>(null);

  let currentList = models;
  if (comparisonDimension === 'client') currentList = clients;
  else if (comparisonDimension === 'provider') currentList = providers;

  const maxVal = Math.max(
    ...currentList.map(item => comparisonMetric === 'cost' ? item.estimatedCostUsd : item.totalTokens),
    1
  );

  const totalSum = currentList.reduce(
    (acc, item) => acc + (comparisonMetric === 'cost' ? item.estimatedCostUsd : item.totalTokens),
    0
  );

  const maxTrendTokens = Math.max(...trend.map(t => t.totalTokens), 1000);

  return (
    <div className="dash-row">
      {/* Left: Usage Panel with Stat Row & Trend Chart */}
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
                    <p>统计当前时间范围内本机开发客户端产生的输入输出 Token 总和。</p>
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
              <strong id="overview-cost">${summary.estimatedCostUsd.toFixed(3)}</strong>
              <small>折合约 ¥{(summary.estimatedCostUsd * 7.25).toFixed(2)} CNY</small>
            </div>

            <div className="stat">
              <div className="stat-label">请求调用量</div>
              <strong>{summary.requestCount.toLocaleString()} <span className="unit">次</span></strong>
              <small>
                平均: {summary.requestCount > 0 ? formatTokens(Math.round(summary.totalTokens / summary.requestCount)) : 0}/次
              </small>
            </div>

            <div className="stat">
              <div className="stat-label">缓存命中与推理</div>
              <strong>{formatTokens(summary.cacheReadTokens)}</strong>
              <small>推理输出: {formatTokens(summary.reasoningTokens)}</small>
            </div>
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

        {/* Trend Chart Heading */}
        <div className="chart-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="title-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 650 }}>Token 消耗趋势（14 天）</h3>
            <details className="info-help">
              <summary aria-label="消耗趋势说明">?</summary>
              <div className="help-content">
                <strong>消耗趋势说明</strong>
                <p>每日调用产生的 Token 总消耗柱状走势，悬停柱子可查看具体时间与开销。</p>
              </div>
            </details>
          </div>

          {hoveredPoint ? (
            <div style={{ fontSize: '12px', color: 'var(--text)', background: 'var(--glass-hi)', padding: '3px 12px', borderRadius: '12px', border: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }}>
              <strong>{hoveredPoint.date}</strong>: {formatTokens(hoveredPoint.totalTokens)} tokens (${hoveredPoint.estimatedCostUsd.toFixed(2)})
            </div>
          ) : (
            <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>悬停查看日期详情</span>
          )}
        </div>

        {/* SVG / CSS Bars Chart */}
        <div style={{ height: '170px', display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '16px 0 8px', borderBottom: '1px solid var(--border)' }}>
          {trend.map((point) => {
            const h = Math.max(4, (point.totalTokens / maxTrendTokens) * 100);
            const isHovered = hoveredPoint?.date === point.date;

            return (
              <div
                key={point.date}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint(point)}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <div
                  style={{
                    width: '100%',
                    maxWidth: '24px',
                    height: `${h}%`,
                    borderRadius: '4px 4px 0 0',
                    background: isHovered
                      ? 'var(--accent-hi)'
                      : point.totalTokens > 0
                      ? 'var(--accent)'
                      : 'var(--track)',
                    boxShadow: isHovered ? '0 0 12px var(--accent)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginTop: '8px', fontVariantNumeric: 'tabular-nums' }}>
          {trend.length > 0 && (
            <>
              <span>{trend[0].date}</span>
              <span>{trend[Math.floor(trend.length / 2)].date}</span>
              <span>{trend[trend.length - 1].date}</span>
            </>
          )}
        </div>
      </div>

      {/* Right: Side Panel with Model & Client Comparison */}
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

          {/* Controls: Dimension + Metric */}
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
              {comparisonMetric === 'cost' ? `$${totalSum.toFixed(3)}` : formatTokens(totalSum)}
            </strong>
            <span id="model-comparison-unit">{comparisonMetric === 'cost' ? 'USD' : 'Tokens'}</span>
          </div>

          {/* Normalized Track List */}
          <ol className="comparison-list" tabIndex={0} style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {currentList.map((item) => {
              const val = comparisonMetric === 'cost' ? item.estimatedCostUsd : item.totalTokens;
              const fillPercent = Math.max(3, (val / maxVal) * 100);

              return (
                <li key={item.name} className="comparison-item">
                  <div className="comparison-item-heading">
                    <span className="comparison-model-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="comparison-model-value">
                      {comparisonMetric === 'cost' ? `$${item.estimatedCostUsd.toFixed(3)}` : formatTokens(item.totalTokens)}
                      <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '6px' }}>({item.percentage}%)</span>
                    </span>
                  </div>
                  <div className="comparison-track">
                    <span style={{ width: `${fillPercent}%` }}></span>
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
