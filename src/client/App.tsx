import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { OverviewDashboard } from './components/OverviewDashboard';
import { UsageDetailSection } from './components/UsageDetailSection';
import {
  fetchQuota,
  refreshQuota,
  fetchSummary,
  fetchTrend,
  fetchByModel,
  fetchByProvider,
  fetchByClient,
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

export const App: React.FC = () => {
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);
  const [models, setModels] = useState<GroupedUsage[]>([]);
  const [providers, setProviders] = useState<GroupedUsage[]>([]);
  const [clients, setClients] = useState<GroupedUsage[]>([]);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [range, setRange] = useState<UsageRange>('all');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (currentRange: UsageRange) => {
    try {
      setError(null);
      const [quotaData, summaryRes, trendData, modelData, providerData, clientData, recordsData] = await Promise.all([
        fetchQuota(),
        fetchSummary(currentRange),
        fetchTrend(14),
        fetchByModel(currentRange),
        fetchByProvider(currentRange),
        fetchByClient(currentRange),
        fetchRecentRecords(50),
      ]);

      setQuotaState(quotaData);
      setSummary(summaryRes.summary);
      setTrend(trendData);
      setModels(modelData);
      setProviders(providerData);
      setClients(clientData);
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
    <>
      <a className="skip-link" href="#main">跳至主要内容</a>
      <Header onRefresh={handleRefresh} isRefreshing={isRefreshing} />

      <main id="main" className="shell" tabIndex={-1}>
        <header className="hero">
          <div>
            <h1>用量控制台</h1>
            <p className="subtitle">在统一视图查看 Codex / Claude / Antigravity / Grok 额度与本地 Token 用量</p>
          </div>
        </header>

        {error && (
          <aside className="notice" style={{ padding: '12px 18px', border: '1px solid var(--danger)', borderRadius: '12px', background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: '20px' }}>
            数据加载提示: {error}
          </aside>
        )}

        {/* Section 1: 剩余额度 */}
        <section className="section quota-section" aria-labelledby="quota-title">
          <div className="section-heading">
            <div className="title-row">
              <h2 id="quota-title">剩余额度</h2>
              <div className="help-tip">
                <details className="info-help">
                  <summary aria-label="额度与金额口径">?</summary>
                  <div className="help-content">
                    <strong>额度与金额口径</strong>
                    <p>展示各服务商当前登录账号的周期配额，以垂直电池仪表展示剩余百分比与重置倒计时。</p>
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div id="provider-grid" className="provider-grid">
            {providerList.map((p) => (
              <QuotaCard key={p.provider} quota={p} />
            ))}
            {providerList.length === 0 && (
              <div className="panel" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px' }}>
                <p className="hint">正在连接各平台额度 API…</p>
              </div>
            )}
          </div>
        </section>

        {/* Section 2: 趋势与用量 */}
        {summary && (
          <section className="section" aria-labelledby="overview-title">
            <div className="section-heading">
              <div className="title-row">
                <h2 id="overview-title">趋势与用量</h2>
                <details className="info-help">
                  <summary aria-label="关于数据">?</summary>
                  <div className="help-content">
                    <strong>关于用量数据</strong>
                    <p>自动聚合本地已有的会话日志与账本，费用按公开 API 标价折算估算。</p>
                  </div>
                </details>
              </div>
            </div>

            <OverviewDashboard
              summary={summary}
              trend={trend}
              models={models}
              providers={providers}
              clients={clients}
              range={range}
              onRangeChange={setRange}
            />
          </section>
        )}

        {/* Section 3: 用量分析与明细 */}
        <UsageDetailSection
          models={models}
          clients={clients}
          providers={providers}
          records={records}
        />
      </main>

      <footer style={{ maxWidth: '1240px', margin: 'auto', padding: '24px 32px 48px', color: 'var(--muted)', fontSize: '12px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <p>Usage Console · 基于 Node.js + React 19 · 采用 Pi Quota Monitor 视觉系统规范</p>
      </footer>
    </>
  );
};
