import React, { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { DailyTrendPoint } from '../types';

interface UsageTrendProps {
  trend: DailyTrendPoint[];
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export const UsageTrend: React.FC<UsageTrendProps> = ({ trend }) => {
  const [hoveredPoint, setHoveredPoint] = useState<DailyTrendPoint | null>(null);

  const maxTokens = Math.max(...trend.map(t => t.totalTokens), 1000);

  return (
    <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">14 天用量走势</h3>
        </div>

        {hoveredPoint ? (
          <div className="text-xs text-slate-300 flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60">
            <span className="font-semibold text-emerald-400">{hoveredPoint.date}</span>
            <span>{formatTokens(hoveredPoint.totalTokens)} tokens</span>
            <span className="text-slate-400">(${hoveredPoint.estimatedCostUsd.toFixed(3)})</span>
            <span className="text-slate-400">({hoveredPoint.requestCount} 次)</span>
          </div>
        ) : (
          <span className="text-xs text-slate-500">悬停查看每日详情</span>
        )}
      </div>

      {/* Bar Chart Container */}
      <div className="h-44 flex items-end gap-1.5 sm:gap-2 pt-6 pb-2 border-b border-slate-800/60">
        {trend.map((point) => {
          const heightPercent = Math.max(3, (point.totalTokens / maxTokens) * 100);
          const isHovered = hoveredPoint?.date === point.date;

          return (
            <div
              key={point.date}
              className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
              onMouseEnter={() => setHoveredPoint(point)}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <div
                className={`w-full max-w-[28px] rounded-t-sm transition-all duration-200 ${
                  isHovered
                    ? 'bg-emerald-400 shadow-md shadow-emerald-500/20'
                    : point.totalTokens > 0
                    ? 'bg-emerald-600/70 hover:bg-emerald-500'
                    : 'bg-slate-800/40'
                }`}
                style={{ height: `${heightPercent}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Date Labels */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
        {trend.length > 0 && (
          <>
            <span>{trend[0].date.slice(5)}</span>
            <span>{trend[Math.floor(trend.length / 2)].date.slice(5)}</span>
            <span>{trend[trend.length - 1].date.slice(5)}</span>
          </>
        )}
      </div>
    </div>
  );
};
