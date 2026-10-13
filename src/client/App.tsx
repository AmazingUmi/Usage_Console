import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { OverviewDashboard } from './components/OverviewDashboard';
import { UsageDetailSection } from './components/UsageDetailSection';
import { fetchQuota, refreshQuota, fetchUsageOverview, syncUsage, trendDaysFor } from './api';
import { withProviderPlaceholders } from './lib/providers';
import type {
  QuotaState,
  UsageSummary,
  DailyTrendPoint,
  GroupedUsage,
  TokenUsageRecord,
  UsageRange,
  ConnectionState,
} from './types';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const App: React.FC = () => {
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);
  const [models, setModels] = useState<GroupedUsage[]>([]);
  const [providers, setProviders] = useState<GroupedUsage[]>([]);
  const [clients, setClients] = useState<GroupedUsage[]>([]);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [range, setRange] = useState<UsageRange>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [includeAgyClaude, setIncludeAgyClaude] = useState(false);

  const applyUsageOverview = useCallback((data: Awaited<ReturnType<typeof fetchUsageOverview>>) => {
    setSummary(data.summary);
    setTrend(data.trend ?? []);
    setModels(data.models ?? []);
    setProviders(data.providers ?? []);
    setClients(data.clients ?? []);
    setRecords(data.records ?? []);
    setLastUpdated(data.lastSyncTime || Date.now());
  }, []);

  const loadQuota = useCallback(async (signal?: AbortSignal) => {
    try {
      const quotaData = await fetchQuota(signal);
      setQuotaState(quotaData);
      setConnectionState('connected');
    } catch (err) {
      if (isAbortError(err)) return;
      console.error('Failed to load quota:', err);
      setConnectionState('offline');
    }
  }, []);

  const loadUsage = useCallback(async (currentRange: UsageRange, excludeAgyClaude: boolean, signal?: AbortSignal) => {
    try {
      setError(null);
      const data = await fetchUsageOverview(currentRange, {
        days: trendDaysFor(currentRange),
        excludeAgyClaude,
        signal,
      });
      if (signal?.aborted) return;
      applyUsageOverview(data);
      setConnectionState('connected');
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return;
      console.error('Failed to load usage data:', err);
      setError((err as Error).message);
      setConnectionState('offline');
    } finally {
      if (!signal?.aborted) setIsLoadingUsage(false);
    }
  }, [applyUsageOverview]);

  useEffect(() => {
    const controller = new AbortController();
    loadQuota(controller.signal);
    return () => controller.abort();
  }, [loadQuota]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingUsage(true);
    loadUsage(range, !includeAgyClaude, controller.signal);
    return () => controller.abort();
  }, [range, includeAgyClaude, loadUsage]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setConnectionState('connecting');
    try {
      const [quotaResult] = await Promise.allSettled([refreshQuota(), syncUsage()]);
      if (quotaResult.status === 'fulfilled') {
        setQuotaState(quotaResult.value);
      }
      await loadUsage(range, !includeAgyClaude);
    } catch (err) {
      console.error('Refresh failed:', err);
      setConnectionState('offline');
    } finally {
      setIsRefreshing(false);
    }
  };

  const providerList = useMemo(() => {
    const live = quotaState?.providers ? Object.values(quotaState.providers) : [];
    return withProviderPlaceholders(live);
  }, [quotaState]);

  return (
    <>
      <a className="skip-link" href="#main">跳至主要内容</a>
      <Header
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        connectionState={connectionState}
        lastUpdated={lastUpdated}
      />

      <main id="main" className="shell" tabIndex={-1}>
        <header className="hero">
          <div>
            <h1>用量控制台</h1>
            <p className="subtitle">在统一视图查看 Codex / Claude / Antigravity / Grok 额度与本地 Token 用量</p>
          </div>
        </header>

        {error && (
          <aside className="notice" role="alert">
            数据加载提示: {error}
          </aside>
        )}

        <section className="section quota-section" aria-labelledby="quota-title">
          <div className="section-heading">
            <div className="title-row">
              <h2 id="quota-title">剩余额度</h2>
              <div className="help-tip">
                <details className="info-help">
                  <summary aria-label="额度与金额口径">?</summary>
                  <div className="help-content">
                    <strong>额度与金额口径</strong>
                    <p>展示各服务商当前登录账号的周期配额。未配置的平台会显示占位卡，避免页面空白。</p>
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div id="provider-grid" className="provider-grid">
            {providerList.map((quota) => (
              <QuotaCard
                key={`${quota.provider}-${quota.displayName}`}
                quota={quota}
                includeAgyClaude={includeAgyClaude}
              />
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="overview-title">
          <div className="section-heading">
            <div className="title-row">
              <h2 id="overview-title">趋势与用量</h2>
              <details className="info-help">
                <summary aria-label="关于数据">?</summary>
                <div className="help-content">
                  <strong>关于用量数据</strong>
                  <p>自动聚合本地已有的会话日志与账本，费用按公开 API 标价折算估算。切换时间范围不会重复拉取额度。</p>
                </div>
              </details>
            </div>
          </div>

          {summary ? (
            <OverviewDashboard
              summary={summary}
              trend={trend}
              models={models}
              providers={providers}
              clients={clients}
              range={range}
              onRangeChange={setRange}
              includeAgyClaude={includeAgyClaude}
              onIncludeAgyClaudeChange={setIncludeAgyClaude}
            />
          ) : (
            <div className="panel loading-panel">
              <p className="hint">{isLoadingUsage ? '正在加载用量数据…' : '暂无用量数据'}</p>
            </div>
          )}
        </section>

        <UsageDetailSection
          models={models}
          clients={clients}
          providers={providers}
          records={records}
        />
      </main>

      <footer className="app-footer">
        <p>Usage Console · 基于 Node.js + React 19 · 采用 Pi Quota Monitor 视觉系统规范</p>
      </footer>
    </>
  );
};
