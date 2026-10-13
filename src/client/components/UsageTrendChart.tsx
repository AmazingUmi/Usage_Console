import React, { useId, useMemo, useRef, useState, useEffect } from 'react';
import type { DailyTrendPoint } from '../types';
import { formatTokens, formatUsd } from '../lib/format';

interface UsageTrendChartProps {
  trend: DailyTrendPoint[];
}

interface Series {
  key: 'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens' | 'estimatedCostUsd';
  label: string;
  color: string;
  axis: 'tokens' | 'cost';
  dashed?: boolean;
}

const SERIES: Series[] = [
  { key: 'inputTokens', label: '输入 Tokens', color: '#3b82f6', axis: 'tokens' },
  { key: 'outputTokens', label: '输出 Tokens', color: '#22c55e', axis: 'tokens' },
  { key: 'cacheWriteTokens', label: '缓存创建', color: '#f97316', axis: 'tokens' },
  { key: 'cacheReadTokens', label: '缓存命中', color: '#a855f7', axis: 'tokens' },
  { key: 'estimatedCostUsd', label: '估算费用', color: '#f43f5e', axis: 'cost', dashed: true },
];

const HEIGHT = 214;
const PAD = { top: 16, right: 58, bottom: 28, left: 52 };

function seriesValue(point: DailyTrendPoint, key: Series['key']): number {
  const value = Number(point[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function paddedMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value * 1.08;
}

function formatCostTick(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
  if (Math.abs(value) >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function tickLabel(date: string, withYear: boolean): string {
  const [year, month, day] = date.split('-');
  if (!month || !day) return date.slice(5);
  return withYear ? `${year.slice(2)}-${month}-${day}` : `${month}-${day}`;
}

function monotonePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  const tangent: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x || 1;
    slope[i] = (points[i + 1].y - points[i].y) / dx[i];
  }
  tangent[0] = slope[0];
  tangent[points.length - 1] = slope[slope.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < slope.length; i += 1) {
    if (Math.abs(slope[i]) < 1e-6) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const hypot = a * a + b * b;
    if (hypot > 9) {
      const scale = 3 / Math.sqrt(hypot);
      tangent[i] = scale * a * slope[i];
      tangent[i + 1] = scale * b * slope[i];
    }
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const c1x = points[i].x + dx[i] / 3;
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return path;
}

export const UsageTrendChart: React.FC<UsageTrendChartProps> = ({ trend }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');

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
    const innerWidth = Math.max(40, width - PAD.left - PAD.right);
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const tokenMax = paddedMax(Math.max(0, ...trend.flatMap((point) => SERIES.filter((series) => series.axis === 'tokens').map((series) => seriesValue(point, series.key)))));
    const costMax = paddedMax(Math.max(0, ...trend.map((point) => seriesValue(point, 'estimatedCostUsd'))));
    const xOf = (index: number) => PAD.left + (trend.length <= 1 ? innerWidth / 2 : (index / (trend.length - 1)) * innerWidth);
    const yOf = (value: number, max: number) => PAD.top + innerHeight - (Math.max(0, value) / max) * innerHeight;
    const coords = trend.map((point, index) => ({
      x: xOf(index),
      point,
      y: Object.fromEntries(SERIES.map((series) => [
        series.key,
        yOf(seriesValue(point, series.key), series.axis === 'cost' ? costMax : tokenMax),
      ])) as Record<Series['key'], number>,
    }));
    const withYear = trend.length > 1 && trend[0].date.slice(0, 4) !== trend[trend.length - 1].date.slice(0, 4);
    const labelStep = Math.max(1, Math.ceil(trend.length / (width < 560 ? 4 : 6)));
    return { innerHeight, tokenMax, costMax, yOf, coords, withYear, labelStep };
  }, [trend, width]);

  const hoverPoint = hover == null ? null : plot.coords[hover];
  const tooltipLeft = hoverPoint ? Math.min(width - 16, Math.max(16, hoverPoint.x)) : 0;
  const flipTooltip = hoverPoint ? hoverPoint.x > width - 230 : false;

  const moveHover = (clientX: number, bounds: DOMRect) => {
    if (plot.coords.length === 0 || bounds.width <= 0) return;
    const x = ((clientX - bounds.left) / bounds.width) * width;
    let best = 0;
    let bestDist = Infinity;
    plot.coords.forEach((coord, index) => {
      const dist = Math.abs(coord.x - x);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    setHover(best);
  };

  if (trend.length === 0) {
    return <div className="trend-line-chart is-empty">此区间暂无趋势数据</div>;
  }

  return (
    <div className="trend-line-chart" ref={hostRef} onPointerLeave={() => setHover(null)}>
      <svg
        className="trend-line-svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label="用量趋势折线图，包含输入、输出、缓存和估算费用"
        onPointerMove={(event) => moveHover(event.clientX, event.currentTarget.getBoundingClientRect())}
      >
        <defs>
          {SERIES.filter((series) => !series.dashed).map((series) => (
            <linearGradient key={series.key} id={`${gradientId}-${series.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={series.color} stopOpacity="0.16" />
              <stop offset="95%" stopColor={series.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = PAD.top + plot.innerHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
              <text className="chart-tick" x={PAD.left - 8} y={y + 4} textAnchor="end">
                {formatTokens(plot.tokenMax * ratio)}
              </text>
              <text className="chart-tick" x={width - PAD.right + 8} y={y + 4}>
                {formatCostTick(plot.costMax * ratio)}
              </text>
            </g>
          );
        })}
        {plot.coords.map((coord, index) => (
          index % plot.labelStep === 0 || index === trend.length - 1 ? (
            <text key={coord.point.date} className="chart-tick" x={coord.x} y={HEIGHT - 8} textAnchor="middle">
              {tickLabel(coord.point.date, plot.withYear)}
            </text>
          ) : null
        ))}
        {SERIES.map((series) => {
          const line = plot.coords.map((coord) => ({ x: coord.x, y: coord.y[series.key] }));
          const path = monotonePath(line);
          const area = series.dashed || line.length === 0
            ? ''
            : `${path} L ${line[line.length - 1].x} ${PAD.top + plot.innerHeight} L ${line[0].x} ${PAD.top + plot.innerHeight} Z`;
          const single = trend.filter((point) => seriesValue(point, series.key) > 0).length === 1;
          return (
            <g key={series.key}>
              {area && <path d={area} fill={`url(#${gradientId}-${series.key})`} stroke="none" />}
              <path
                d={path}
                fill="none"
                stroke={series.color}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={series.dashed ? '4 4' : undefined}
              />
              {single && line.map((dot) => (
                <circle key={`${series.key}-${dot.x}`} cx={dot.x} cy={dot.y} r="3" fill={series.color} />
              ))}
            </g>
          );
        })}
        {hoverPoint && (
          <g>
            <line className="chart-cursor" x1={hoverPoint.x} x2={hoverPoint.x} y1={PAD.top} y2={PAD.top + plot.innerHeight} />
            {SERIES.map((series) => (
              <circle
                key={series.key}
                cx={hoverPoint.x}
                cy={hoverPoint.y[series.key]}
                r="3.5"
                fill={series.color}
                stroke="var(--solid)"
                strokeWidth="2"
              />
            ))}
          </g>
        )}
      </svg>
      {hoverPoint && (
        <div
          className="line-tooltip"
          style={{ left: tooltipLeft, transform: flipTooltip ? 'translate(calc(-100% - 12px), 0)' : 'translate(12px, 0)' }}
          role="status"
        >
          <strong>{hoverPoint.point.date}</strong>
          {SERIES.map((series) => (
            <span key={series.key}>
              <i style={{ background: series.color }} />
              {series.label}
              <b>
                {series.axis === 'cost'
                  ? formatUsd(seriesValue(hoverPoint.point, series.key), 4)
                  : formatTokens(seriesValue(hoverPoint.point, series.key))}
              </b>
            </span>
          ))}
          <span>请求 <b>{hoverPoint.point.requestCount || 0} 次</b></span>
        </div>
      )}
      <div className="line-legend">
        {SERIES.map((series) => (
          <span key={series.key}>
            <i style={{ borderColor: series.color, borderStyle: series.dashed ? 'dashed' : 'solid' }} />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
};
