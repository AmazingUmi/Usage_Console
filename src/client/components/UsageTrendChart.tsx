import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DailyTrendPoint } from '../types';
import { formatMillis, formatTokPerSec, formatTokens, formatUsd } from '../lib/format';
import { useI18n } from '../i18n';

export type TrendMetric = 'tokens' | 'cost' | 'speed';
export type TrendKind = 'bar' | 'line';

interface UsageTrendChartProps {
  trend: DailyTrendPoint[];
  metric: TrendMetric;
  kind: TrendKind;
  /** Series the user switched off in the legend (line view only). */
  hidden?: ReadonlySet<string>;
}

type SeriesKey = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'estimatedCostUsd' | 'tokensPerSecondMedian' | 'ttftMedianMs';

interface Series {
  key: SeriesKey;
  labelKey: string;
  color: string;
}

const INPUT: Series = { key: 'inputTokens', labelKey: 'trend.input', color: 'var(--series-1)' };
const OUTPUT: Series = { key: 'outputTokens', labelKey: 'trend.output', color: 'var(--series-2)' };
const CACHE_READ: Series = { key: 'cacheReadTokens', labelKey: 'trend.cacheRead', color: 'var(--series-3)' };
const CACHE_WRITE: Series = { key: 'cacheWriteTokens', labelKey: 'trend.cacheWrite', color: 'var(--series-4)' };
const COST: Series = { key: 'estimatedCostUsd', labelKey: 'trend.estCost', color: 'var(--series-1)' };
const SPEED: Series = { key: 'tokensPerSecondMedian', labelKey: 'speed.output', color: 'var(--series-2)' };
const TTFT: Series = { key: 'ttftMedianMs', labelKey: 'speed.ttft', color: 'var(--series-1)' };

/** Bars stack input + output; lines show every token series on its own (like codex-switch's trend chart). */
export function seriesFor(metric: TrendMetric, kind: TrendKind = 'bar'): Series[] {
  if (metric === 'speed') return [SPEED, TTFT];
  if (metric === 'cost') return [COST];
  return kind === 'line' ? [INPUT, OUTPUT, CACHE_READ, CACHE_WRITE] : [INPUT, OUTPUT];
}

const HEIGHT = 240;
const PAD = { top: 10, right: 8, bottom: 26, left: 52 };

function value(point: DailyTrendPoint, key: SeriesKey): number {
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

/** Monotone cubic curve through the points: smooth, and never overshoots between samples. */
function monotonePath(points: Array<[number, number]>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0][0]} ${points[0][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const sum = a * a + b * b;
    if (sum > 9) {
      const k = 3 / Math.sqrt(sum);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const third = dx[i] / 3;
    d += ` C ${points[i][0] + third} ${points[i][1] + tangent[i] * third}, ${points[i + 1][0] - third} ${points[i + 1][1] - tangent[i + 1] * third}, ${points[i + 1][0]} ${points[i + 1][1]}`;
  }
  return d;
}

const NONE: ReadonlySet<string> = new Set();

const TokenTrendChart: React.FC<UsageTrendChartProps> = ({ trend, metric, kind, hidden = NONE }) => {
  const { t, locale } = useI18n();
  const gradientId = `trend-${useId().replace(/:/g, '')}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(
    () => seriesFor(metric, kind).filter((s) => kind !== 'line' || !hidden.has(s.key)),
    [metric, kind, hidden],
  );

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
    // Stacked bars reach the sum of their segments; lines only reach the tallest single series.
    const peaks = trend.map((point) => (kind === 'bar'
      ? series.reduce((sum, s) => sum + value(point, s.key), 0)
      : Math.max(0, ...series.map((s) => value(point, s.key)))));
    const max = niceMax(Math.max(0, ...peaks));
    const slot = innerW / Math.max(1, trend.length);
    const barW = Math.max(3, Math.min(28, slot * 0.62));
    const labelStep = Math.max(1, Math.ceil(trend.length / Math.max(2, Math.floor(innerW / 64))));
    return { innerW, innerH, max, slot, barW, labelStep };
  }, [trend, width, series, kind]);

  if (trend.length === 0) {
    return <div className="trend-chart is-empty">{t('trend.empty')}</div>;
  }

  const yOf = (n: number) => PAD.top + plot.innerH - (n / plot.max) * plot.innerH;
  const xOf = (index: number) => PAD.left + plot.slot * index + plot.slot / 2;
  const fmt = metric === 'cost' ? costTick : formatTokens;
  const hovered = hover == null ? null : trend[hover];
  const tooltipLeft = hover == null ? 0 : xOf(hover);
  const flip = tooltipLeft > width - 220;
  const baseline = yOf(0);

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
        aria-label={t(metric === 'cost' ? 'trend.aria.cost' : kind === 'line' ? 'trend.aria.line' : 'trend.aria.tokens')}
        onPointerMove={onMove}
      >
        {kind === 'line' && (
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
        )}
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

        {kind === 'bar' && trend.map((point, index) => {
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

        {kind === 'line' && series.map((s) => {
          const points = trend.map((point, index): [number, number] => [xOf(index), yOf(value(point, s.key))]);
          const line = monotonePath(points);
          const area = points.length > 1
            ? `${line} L ${points[points.length - 1][0]} ${baseline} L ${points[0][0]} ${baseline} Z`
            : '';
          return (
            <g key={s.key}>
              {area && <path d={area} fill={`url(#${gradientId}-${s.key})`} />}
              <path className="trend-line" d={line} stroke={s.color} />
              {points.length === 1 && <circle cx={points[0][0]} cy={points[0][1]} r={3.5} fill={s.color} />}
              {hover != null && (
                <circle className="trend-dot" cx={points[hover][0]} cy={points[hover][1]} r={4} stroke={s.color} />
              )}
            </g>
          );
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
          <div><i style={{ background: 'var(--series-1)' }} />{t('trend.input')}<b>{formatTokens(hovered.inputTokens)}</b></div>
          <div><i style={{ background: 'var(--series-2)' }} />{t('trend.output')}<b>{formatTokens(hovered.outputTokens)}</b></div>
          <div><i style={{ background: kind === 'line' ? 'var(--series-3)' : 'transparent' }} />{t('trend.cacheRead')}<b>{formatTokens(hovered.cacheReadTokens ?? 0)}</b></div>
          <div><i style={{ background: kind === 'line' ? 'var(--series-4)' : 'transparent' }} />{t('trend.cacheWrite')}<b>{formatTokens(hovered.cacheWriteTokens ?? 0)}</b></div>
          <hr />
          <div>{t('trend.estCost')}<b>{formatUsd(hovered.estimatedCostUsd, 2)}</b></div>
          <div>{t('trend.requests')}<b>{t('trend.times', { n: (hovered.requestCount || 0).toLocaleString(locale) })}</b></div>
        </div>
      )}
    </div>
  );
};

function speedRate(point: DailyTrendPoint): number | null {
  if (!point.speedSamples) return null;
  const n = point.tokensPerSecondMedian;
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function ttftOf(point: DailyTrendPoint): number | null {
  if (!point.ttftSamples) return null;
  const n = point.ttftMedianMs;
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function lineSegments(points: Array<[number, number] | null>): Array<Array<[number, number]>> {
  const groups: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  for (const point of points) {
    if (!point) {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length) groups.push(current);
  return groups;
}

function speedTick(n: number): string {
  if (n <= 0) return '0';
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(n >= 10 ? 0 : 1);
}

function barPath(x: number, top: number, height: number, barW: number): string {
  const r = Math.min(4, barW / 2, height);
  return `M ${x} ${top + height} V ${top + r} Q ${x} ${top} ${x + r} ${top} H ${x + barW - r} Q ${x + barW} ${top} ${x + barW} ${top + r} V ${top + height} Z`;
}

const SPEED_PAD = { top: 10, right: 58, bottom: 26, left: 52 };

/** Output speed on the left axis, time-to-first-token on the right. Missing days stay gaps. */
const SpeedTrendChart: React.FC<Omit<UsageTrendChartProps, 'metric'>> = ({ trend, kind, hidden = NONE }) => {
  const { t, locale } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const showSpeed = !hidden.has(SPEED.key);
  const showTtft = !hidden.has(TTFT.key);

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
    const innerW = Math.max(40, width - SPEED_PAD.left - SPEED_PAD.right);
    const innerH = HEIGHT - SPEED_PAD.top - SPEED_PAD.bottom;
    const leftMax = niceMax(Math.max(0, ...trend.map((point) => speedRate(point) ?? 0)));
    const rightMax = niceMax(Math.max(0, ...trend.map((point) => ttftOf(point) ?? 0)));
    const slot = innerW / Math.max(1, trend.length);
    const labelStep = Math.max(1, Math.ceil(trend.length / Math.max(2, Math.floor(innerW / 64))));
    return { innerW, innerH, leftMax, rightMax, slot, labelStep };
  }, [trend, width]);

  if (trend.length === 0 || trend.every((point) => speedRate(point) == null && ttftOf(point) == null)) {
    return <div className="trend-chart is-empty">{t('trend.empty.speed')}</div>;
  }

  const yLeft = (n: number) => SPEED_PAD.top + plot.innerH - (n / plot.leftMax) * plot.innerH;
  const yRight = (n: number) => SPEED_PAD.top + plot.innerH - (n / plot.rightMax) * plot.innerH;
  const xOf = (index: number) => SPEED_PAD.left + plot.slot * index + plot.slot / 2;
  const baseline = yLeft(0);
  const hovered = hover == null ? null : trend[hover];
  const tooltipLeft = hover == null ? 0 : xOf(hover);
  const flip = tooltipLeft > width - 220;
  const speedPoints = trend.map((point, index): [number, number] | null => {
    const rate = speedRate(point);
    return rate == null ? null : [xOf(index), yLeft(rate)];
  });
  const ttftPoints = trend.map((point, index): [number, number] | null => {
    const wait = ttftOf(point);
    return wait == null ? null : [xOf(index), yRight(wait)];
  });

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * width - SPEED_PAD.left;
    const index = Math.floor(x / plot.slot);
    setHover(index >= 0 && index < trend.length ? index : null);
  };

  const drawLine = (groups: Array<Array<[number, number]>>, color: string) => groups.map((group, index) => {
    const line = monotonePath(group);
    return (
      <g key={`${color}-${index}`}>
        <path className="trend-line" d={line} stroke={color} />
        {group.length === 1 && <circle cx={group[0][0]} cy={group[0][1]} r={3.5} fill={color} />}
      </g>
    );
  });

  return (
    <div className="trend-chart" ref={hostRef} onPointerLeave={() => setHover(null)}>
      <svg
        className="trend-svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={t('trend.aria.speed')}
        onPointerMove={onMove}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = (showSpeed ? yLeft(plot.leftMax * ratio) : yRight(plot.rightMax * ratio));
          return (
            <g key={ratio}>
              <line className={ratio === 0 ? 'chart-baseline' : 'chart-grid'} x1={SPEED_PAD.left} x2={width - SPEED_PAD.right} y1={y} y2={y} />
              {showSpeed && <text className="chart-tick" x={SPEED_PAD.left - 8} y={yLeft(plot.leftMax * ratio) + 4} textAnchor="end">{speedTick(plot.leftMax * ratio)}</text>}
              {showTtft && <text className="chart-tick" x={width - SPEED_PAD.right + 8} y={yRight(plot.rightMax * ratio) + 4} textAnchor="start">{ratio === 0 ? '0' : formatMillis(plot.rightMax * ratio)}</text>}
            </g>
          );
        })}
        {hover != null && (
          <rect className="chart-hover-band" x={SPEED_PAD.left + plot.slot * hover} y={SPEED_PAD.top} width={plot.slot} height={plot.innerH} rx={4} />
        )}
        {kind === 'bar' && trend.map((point, index) => {
          const columns: Array<{ key: string; color: string; y: number | null }> = [];
          if (showSpeed) columns.push({ key: SPEED.key, color: SPEED.color, y: speedRate(point) == null ? null : yLeft(speedRate(point)!) });
          if (showTtft) columns.push({ key: TTFT.key, color: TTFT.color, y: ttftOf(point) == null ? null : yRight(ttftOf(point)!) });
          if (columns.length === 0) return null;
          const gap = columns.length > 1 ? 2 : 0;
          const barW = Math.max(3, Math.min(14, (plot.slot * 0.72 - gap) / columns.length));
          const origin = xOf(index) - (columns.length * barW + gap * (columns.length - 1)) / 2;
          return (
            <g key={point.date}>
              {columns.map((column, columnIndex) => {
                if (column.y == null) return null;
                const h = Math.max(1, baseline - column.y);
                return <path key={column.key} d={barPath(origin + columnIndex * (barW + gap), baseline - h, h, barW)} fill={column.color} />;
              })}
            </g>
          );
        })}
        {kind === 'line' && showSpeed && drawLine(lineSegments(speedPoints), SPEED.color)}
        {kind === 'line' && showTtft && drawLine(lineSegments(ttftPoints), TTFT.color)}
        {kind === 'line' && hover != null && showSpeed && speedPoints[hover] != null && (
          <circle className="trend-dot" cx={speedPoints[hover]![0]} cy={speedPoints[hover]![1]} r={4} stroke={SPEED.color} />
        )}
        {kind === 'line' && hover != null && showTtft && ttftPoints[hover] != null && (
          <circle className="trend-dot" cx={ttftPoints[hover]![0]} cy={ttftPoints[hover]![1]} r={4} stroke={TTFT.color} />
        )}
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
          {speedRate(hovered) == null && ttftOf(hovered) == null ? (
            <div>{t('trend.speedNone')}</div>
          ) : (
            <>
              <div><i style={{ background: SPEED.color }} />{t('speed.output')}<b>{speedRate(hovered) == null ? '—' : t('speed.perSec', { n: formatTokPerSec(speedRate(hovered), locale) })}</b></div>
              <div><i style={{ background: TTFT.color }} />{t('speed.ttft')}<b>{formatMillis(ttftOf(hovered))}</b></div>
              <div>{t('trend.speedSamples', { speed: hovered.speedSamples ?? 0, ttft: hovered.ttftSamples ?? 0 })}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const UsageTrendChart: React.FC<UsageTrendChartProps> = (props) => (
  props.metric === 'speed'
    ? <SpeedTrendChart trend={props.trend} kind={props.kind} hidden={props.hidden} />
    : <TokenTrendChart {...props} />
);
