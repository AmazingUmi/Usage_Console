import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { OverviewDashboard } from './components/OverviewDashboard';
import { UsageDetailSection } from './components/UsageDetailSection';
import { SettingsPage } from './components/SettingsPage';
import { EditAccountDialog } from './components/EditAccountDialog';
import { fetchQuota, refreshQuota, fetchUsageOverview, fetchSettings, syncUsage, trendDaysFor } from './api';
import { quotaCardsForAccounts } from './lib/providers';
import { Icon } from './components/Icon';
import type {
  ConsoleSettings,
  QuotaState,
  UsageSummary,
  DailyTrendPoint,
  GroupedUsage,
  TokenUsageRecord,
  UsageRange,
  ConnectionState,
} from './types';

const RANGES: Array<{ id: UsageRange; label: string }> = [
  { id: 'today', label: '今天' },
  { id: '7d', label: '7 天' },
  { id: '30d', label: '30 天' },
  { id: 'all', label: '全部' },
];

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
  const [range, setRange] = useState<UsageRange>('7d');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [settings, setSettings] = useState<ConsoleSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<import('./types').ProviderQuota | null>(null);

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

  const loadUsage = useCallback(async (currentRange: UsageRange, signal?: AbortSignal) => {
    try {
      setError(null);
      const data = await fetchUsageOverview(currentRange, {
        days: trendDaysFor(currentRange),
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
    loadUsage(range, controller.signal);
    return () => controller.abort();
  }, [range, loadUsage]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSettings(controller.signal)
      .then(setSettings)
      .catch((err) => {
        if (!isAbortError(err)) console.error('Failed to load settings:', err);
      });
    return () => controller.abort();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setConnectionState('connecting');
    try {
      const [quotaResult] = await Promise.allSettled([refreshQuota(), syncUsage()]);
      if (quotaResult.status === 'fulfilled') {
        setQuotaState(quotaResult.value);
      }
      await loadUsage(range);
      const nextSettings = await fetchSettings().catch(() => null);
      if (nextSettings) setSettings(nextSettings);
    } catch (err) {
      console.error('Refresh failed:', err);
      setConnectionState('offline');
    } finally {
      setIsRefreshing(false);
    }
  };

  const providerList = useMemo(() => {
    const live = quotaState?.providers ? Object.values(quotaState.providers) : [];
    return quotaCardsForAccounts(live, settings?.accounts ?? []);
  }, [quotaState, settings]);

  const openSettings = () => {
    setSettingsOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById('settings-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const hideAgyClaude = settings?.hideAgyClaude ?? true;

  return (
    <>
      <a className="skip-link" href="#main">跳至主要内容</a>
      <Header
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        connectionState={connectionState}
        lastUpdated={lastUpdated}
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          if (settingsOpen) setSettingsOpen(false);
          else openSettings();
        }}
      />

      <main id="main" className="shell" tabIndex={-1}>
        {error && (
          <div className="callout" data-tone="danger" role="alert" style={{ marginBottom: 16 }}>
            <Icon name="alert" size={15} />
            <span>数据加载失败：{error}</span>
          </div>
        )}

        <section className="section" aria-labelledby="quota-title">
          <div className="section-heading">
            <div>
              <h2 id="quota-title">剩余额度</h2>
              <p className="hint">官方订阅窗口的实时剩余比例，只显示已添加的账户</p>
            </div>
          </div>

          {providerList.length === 0 ? (
            <div className="quota-empty">
              <span>{settings ? '还没有账户。登录本机 Claude Code / Codex 后点刷新会自动识别。' : '正在读取账户…'}</span>
              {settings && <button type="button" className="btn btn-sm" onClick={openSettings}>打开设置</button>}
            </div>
          ) : (
            <div className="provider-grid">
              {providerList.map((quota, index) => (
                <QuotaCard
                  key={`${quota.accountCardId || quota.provider}-${index}`}
                  quota={quota}
                  includeAgyClaude={!hideAgyClaude}
                  onEdit={setEditingQuota}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="overview-title">
          <div className="section-heading">
            <div>
              <h2 id="overview-title">本地用量</h2>
              <p className="hint">汇总本机 Claude Code、Codex、Pi、Grok 会话日志，费用按 API 标价估算</p>
            </div>
            <div className="segmented" role="group" aria-label="统计范围">
              {RANGES.map((item) => (
                <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => setRange(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {summary ? (
            <OverviewDashboard
              summary={summary}
              trend={trend}
              models={models}
              providers={providers}
              clients={clients}
            />
          ) : (
            <div className="panel empty">{isLoadingUsage ? '正在加载用量数据…' : '暂无用量数据'}</div>
          )}
        </section>

        <UsageDetailSection
          models={models}
          clients={clients}
          providers={providers}
          records={records}
        />

        <SettingsPage
          open={settingsOpen}
          onToggle={() => setSettingsOpen((value) => !value)}
          settings={settings}
          onSaved={(next, quota) => {
            setSettings(next);
            if (quota) setQuotaState(quota);
            loadUsage(range);
          }}
        />
        <EditAccountDialog
          key={editingQuota?.accountCardId || 'none'}
          quota={editingQuota}
          onClose={() => setEditingQuota(null)}
          onSaved={(next) => setSettings(next)}
        />
      </main>

      <footer className="app-footer">
        <p>Usage Console · 数据只在本机读取，不上传</p>
      </footer>
    </>
  );
};
