import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { UsageMetrics } from './components/UsageMetrics';
import { UsageTrend } from './components/UsageTrend';
import { BreakdownTable } from './components/BreakdownTable';
import { RecentRecordsTable } from './components/RecentRecordsTable';
import {
  fetchQuota,
  refreshQuota,
  fetchSummary,
  fetchTrend,
  fetchByModel,
  fetchByProvider,
  fetchRecentRecords,
  syncUsage,
} from './api';
import type {
  QuotaState,
  UsageSummary,
  DailyTrendPoint,
  GroupedUsage,
  TokenUsageRecord,
  UsageRange,
} from './types';
import { ShieldCheck, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);
  const [models, setModels] = useState<GroupedUsage[]>([]);
  const [providers, setProviders] = useState<GroupedUsage[]>([]);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [range, setRange] = useState<UsageRange>('today');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (currentRange: UsageRange) => {
    try {
      setError(null);
      const [quotaData, summaryRes, trendData, modelData, providerData, recordsData] = await Promise.all([
        fetchQuota(),
        fetchSummary(currentRange),
        fetchTrend(14),
        fetchByModel(currentRange),
        fetchByProvider(currentRange),
        fetchRecentRecords(30),
      ]);

      setQuotaState(quotaData);
      setSummary(summaryRes.summary);
      setTrend(trendData);
      setModels(modelData);
      setProviders(providerData);
      setRecords(recordsData);
    } catch (err) {
      console.error('Failed to load usage data:', err);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadData(range);
  }, [range, loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshQuota(),
        syncUsage(),
      ]);
      await loadData(range);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const providerList = quotaState ? Object.values(quotaState.providers) : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        lastUpdated={quotaState?.updatedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs">
            加载数据提示: {error}
          </div>
        )}

        {/* Section 1: Quota Overview */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100">官方额度状态</h2>
              <p className="text-xs text-slate-400">实时监控各平台 5 小时与每周订阅配额窗口</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {providerList.map((p) => (
              <QuotaCard key={p.provider} quota={p} />
            ))}
            {providerList.length === 0 && (
              <div className="col-span-full py-8 text-center text-slate-500 text-xs bg-slate-900/20 rounded-xl border border-slate-800/40">
                正在加载平台配额...
              </div>
            )}
          </div>
        </section>

        {/* Section 2: Usage Summary Metrics */}
        {summary && (
          <section>
            <UsageMetrics
              summary={summary}
              range={range}
              onRangeChange={setRange}
            />
          </section>
        )}

        {/* Section 3: Trend & Breakdown Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UsageTrend trend={trend} />
          <BreakdownTable models={models} providers={providers} />
        </section>

        {/* Section 4: Recent Records */}
        <section>
          <RecentRecordsTable records={records} />
        </section>
      </main>

      <footer className="border-t border-slate-800/60 py-4 px-6 text-center text-xs text-slate-500">
        <p>Usage Console · 基于 Node.js + React + Tailwind CSS · 本地无侵入监控</p>
      </footer>
    </div>
  );
};
