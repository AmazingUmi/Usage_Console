import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
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

  const maxTokens = Math.max(...trend.map((t) => t.totalTokens), 1000);

  return (
    <div className="glass-panel p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">
              <BarChart3 className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white tracking-tight">14 天用量走势</h3>
          </div>

          {hoveredPoint ? (
            <div className="text-xs text-slate-200 flex items-center gap-2 bg-slate-900/80 px-3 py-1 rounded-full border border-white/10 tabular-nums shadow-sm">
              <span className="font-semibold text-blue-400">{hoveredPoint.date}</span>
              <span>{formatTokens(hoveredPoint.totalTokens)} tokens</span>
              <span className="text-slate-400">(${hoveredPoint.estimatedCostUsd.toFixed(3)})</span>
              <span className="text-slate-400">({hoveredPoint.requestCount} 次)</span>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">悬停查看每日明细</span>
          )}
        </div>

        {/* Bar Chart Container */}
        <div className="h-44 flex items-end gap-1.5 sm:gap-2 pt-6 pb-2 border-b border-white/5">
          {trend.map((point) => {
            const heightPercent = Math.max(4, (point.totalTokens / maxTokens) * 100);
            const isHovered = hoveredPoint?.date === point.date;

            return (
              <div
                key={point.date}
                className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
                onMouseEnter={() => setHoveredPoint(point)}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                <div
                  className={`w-full max-w-[28px] rounded-t-md transition-all duration-200 ${
                    isHovered
                      ? 'bg-blue-400 shadow-lg shadow-blue-500/30'
                      : point.totalTokens > 0
                      ? 'bg-gradient-to-t from-blue-600/70 to-blue-400/90 hover:from-blue-500 hover:to-blue-300'
                      : 'bg-slate-800/40'
                  }`}
                  style={{ height: `${heightPercent}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Labels */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-1 tabular-nums">
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
