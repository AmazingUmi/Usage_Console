import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyTrendPoint } from '../types';
import { formatTokens, formatUsd } from '../lib/format';

export type TrendMetric = 'tokens' | 'cost';

interface UsageTrendChartProps {
  trend: DailyTrendPoint[];
  metric: TrendMetric;
}

interface Series {
  key: 'inputTokens' | 'outputTokens' | 'estimatedCostUsd';
  label: string;
  color: string;
}

const TOKEN_SERIES: Series[] = [
  { key: 'inputTokens', label: '输入', color: 'var(--series-1)' },
  { key: 'outputTokens', label: '输出', color: 'var(--series-2)' },
];
const COST_SERIES: Series[] = [{ key: 'estimatedCostUsd', label: '估算费用', color: 'var(--series-1)' }];

export function seriesFor(metric: TrendMetric): Series[] {
  return metric === 'cost' ? COST_SERIES : TOKEN_SERIES;
}

const HEIGHT = 240;
const PAD = { top: 10, right: 8, bottom: 26, left: 52 };

function value(point: DailyTrendPoint, key: Series['key']): number {
  const n = Number(point[key] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Round the axis max up to 1/2/2.5/5 × 10^n so the ticks land on readable numbers. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * exp >= max) return step * exp;
  }
  return 10 * exp;
}

function costTick(n: number): string {
  if (n === 0) return '$0';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(n % 1 === 0 ? 0 : 1)}`;
  return `$${n.toFixed(2)}`;
}

function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export const UsageTrendChart: React.FC<UsageTrendChartProps> = ({ trend, metric }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const series = seriesFor(metric);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setWidth(Math.max(280, host.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    const innerW = Math.max(40, width - PAD.left - PAD.right);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const totals = trend.map((point) => series.reduce((sum, s) => sum + value(point, s.key), 0));
    const max = niceMax(Math.max(0, ...totals));
    const slot = innerW / Math.max(1, trend.length);
    const barW = Math.max(3, Math.min(28, slot * 0.62));
    const labelStep = Math.max(1, Math.ceil(trend.length / Math.max(2, Math.floor(innerW / 64))));
    return { innerW, innerH, max, slot, barW, labelStep, totals };
  }, [trend, width, series]);

  if (trend.length === 0) {
    return <div className="trend-chart is-empty">此区间暂无趋势数据</div>;
  }

  const yOf = (n: number) => PAD.top + plot.innerH - (n / plot.max) * plot.innerH;
  const xOf = (index: number) => PAD.left + plot.slot * index + plot.slot / 2;
  const fmt = metric === 'cost' ? costTick : formatTokens;
  const hovered = hover == null ? null : trend[hover];
  const tooltipLeft = hover == null ? 0 : xOf(hover);
  const flip = tooltipLeft > width - 220;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * width - PAD.left;
    const index = Math.floor(x / plot.slot);
    setHover(index >= 0 && index < trend.length ? index : null);
  };

  return (
    <div className="trend-chart" ref={hostRef} onPointerLeave={() => setHover(null)}>
      <svg
        className="trend-svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={metric === 'cost' ? '每日估算费用柱状图' : '每日输入与输出 Token 堆叠柱状图'}
        onPointerMove={onMove}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = yOf(plot.max * ratio);
          return (
            <g key={ratio}>
              <line className={ratio === 0 ? 'chart-baseline' : 'chart-grid'} x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
              <text className="chart-tick" x={PAD.left - 8} y={y + 4} textAnchor="end">{fmt(plot.max * ratio)}</text>
            </g>
          );
        })}
        {hover != null && (
          <rect className="chart-hover-band" x={PAD.left + plot.slot * hover} y={PAD.top} width={plot.slot} height={plot.innerH} rx={4} />
        )}
        {trend.map((point, index) => {
          let base = 0;
          const x = xOf(index) - plot.barW / 2;
          const segments = series.map((s, segIndex) => {
            const v = value(point, s.key);
            if (v <= 0) return null;
            const y0 = yOf(base);
            base += v;
            const y1 = yOf(base);
            const isTop = series.slice(segIndex + 1).every((rest) => value(point, rest.key) <= 0);
            // 2px surface gap between stacked segments; rounded only on the top end.
            const h = Math.max(1, y0 - y1 - (segIndex > 0 ? 2 : 0));
            const r = isTop ? Math.min(4, plot.barW / 2, h) : 0;
            const top = y0 - (segIndex > 0 ? 2 : 0) - h;
            const d = `M ${x} ${top + h} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + plot.barW - r} Q ${x + plot.barW} ${top} ${x + plot.barW} ${top + r} V ${top + h} Z`;
            return <path key={s.key} d={d} fill={s.color} />;
          });
          return <g key={point.date}>{segments}</g>;
        })}
        {trend.map((point, index) => (
          index % plot.labelStep === 0 ? (
            <text key={point.date} className="chart-tick" x={xOf(index)} y={HEIGHT - 8} textAnchor="middle">{dayLabel(point.date)}</text>
          ) : null
        ))}
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          role="status"
          style={{ left: tooltipLeft, transform: flip ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)' }}
        >
          <strong>{hovered.date}</strong>
          <div><i style={{ background: 'var(--series-1)' }} />输入<b>{formatTokens(hovered.inputTokens)}</b></div>
          <div><i style={{ background: 'var(--series-2)' }} />输出<b>{formatTokens(hovered.outputTokens)}</b></div>
          <div><i style={{ background: 'transparent' }} />缓存命中<b>{formatTokens(hovered.cacheReadTokens ?? 0)}</b></div>
          <div><i style={{ background: 'transparent' }} />缓存写入<b>{formatTokens(hovered.cacheWriteTokens ?? 0)}</b></div>
          <hr />
          <div>估算费用<b>{formatUsd(hovered.estimatedCostUsd, 2)}</b></div>
          <div>请求<b>{(hovered.requestCount || 0).toLocaleString()} 次</b></div>
        </div>
      )}
    </div>
  );
};
