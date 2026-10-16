import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { OverviewDashboard } from './components/OverviewDashboard';
import { UsageDetailSection } from './components/UsageDetailSection';
import { SettingsPage } from './components/SettingsPage';
import { EditAccountDialog } from './components/EditAccountDialog';
import { AddAccountDialog } from './components/AddAccountDialog';
import { useI18n } from './i18n';
import { fetchQuota, refreshQuota, fetchUsageOverview, fetchSettings, reorderAccounts, syncUsage, trendDaysFor } from './api';
import { quotaCardsForAccounts } from './lib/providers';
import { HelpTip } from './components/HelpTip';
import { Icon } from './components/Icon';
import type {
  AccountType,
  ConsoleSettings,
  QuotaState,
  UsageSummary,
  DailyTrendPoint,
  GroupedUsage,
  TokenUsageRecord,
  UsageRange,
  ConnectionState,
  SpeedReport,
} from './types';

const RANGES: Array<{ id: UsageRange; key: string }> = [
  { id: 'today', key: 'range.today' },
  { id: '7d', key: 'range.7d' },
  { id: '30d', key: 'range.30d' },
  { id: 'all', key: 'range.all' },
];

/**
 * The server polls providers on the "refresh interval" setting; this only re-reads what the server already has,
 * which is cheap, so it can run more often than that interval.
 */
const CACHE_POLL_MS = 15 * 1000;
/** While a card is still "loading", ask again soon instead of waiting for the next cache poll. */
const LOADING_POLL_MS = 3 * 1000;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const App: React.FC = () => {
  const { t } = useI18n();
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);
  const [models, setModels] = useState<GroupedUsage[]>([]);
  const [providers, setProviders] = useState<GroupedUsage[]>([]);
  const [clients, setClients] = useState<GroupedUsage[]>([]);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [speed, setSpeed] = useState<SpeedReport | null>(null);
  const [range, setRange] = useState<UsageRange>('7d');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined);
  const [settings, setSettings] = useState<ConsoleSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<import('./types').ProviderQuota | null>(null);
  /** Non-null while the add-account dialog is open; `type` pre-selects the account type. */
  const [addAccount, setAddAccount] = useState<{ type?: AccountType } | null>(null);
  /** Card being dragged, and the card it is currently over. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const applyUsageOverview = useCallback((data: Awaited<ReturnType<typeof fetchUsageOverview>>) => {
    setSummary(data.summary);
    setTrend(data.trend ?? []);
    setModels(data.models ?? []);
    setProviders(data.providers ?? []);
    setClients(data.clients ?? []);
    setRecords(data.records ?? []);
    setSpeed(data.speed ?? null);
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

  const refreshSeconds = settings?.quotaRefreshIntervalSeconds ?? 120;
  useEffect(() => {
    // Manual-only mode has nothing new to pick up on its own.
    if (refreshSeconds <= 0) return;
    const timer = window.setInterval(() => loadQuota(), CACHE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadQuota, refreshSeconds]);

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

  /** Moves account `fromId` to the position of `toId`, shows it at once, then saves; a failure restores the saved order. */
  const moveCard = useCallback(async (fromId: string, toId: string) => {
    if (!settings || fromId === toId) return;
    const ids = settings.accounts.map((account) => account.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setSettings({ ...settings, accounts: ids.map((id) => settings.accounts.find((account) => account.id === id)!) });
    try {
      setSettings((await reorderAccounts(ids)).settings);
    } catch (err) {
      console.error('Failed to save card order:', err);
      fetchSettings().then(setSettings).catch(() => {});
    }
  }, [settings]);

  const moveCardBy = useCallback((id: string, delta: -1 | 1) => {
    if (!settings) return;
    const ids = settings.accounts.map((account) => account.id);
    const target = ids[ids.indexOf(id) + delta];
    if (target) void moveCard(id, target);
  }, [settings, moveCard]);

  const providerList = useMemo(() => {
    const live = quotaState?.providers ? Object.values(quotaState.providers) : [];
    return quotaCardsForAccounts(live, settings?.accounts ?? [], {
      loaded: quotaState !== null,
      reachable: connectionState !== 'offline',
    });
  }, [quotaState, settings, connectionState]);

  const anyLoading = providerList.some((quota) => quota.status === 'loading' || quota.errorCode === 'offline');
  useEffect(() => {
    if (!anyLoading) return;
    const timer = window.setInterval(() => loadQuota(), LOADING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyLoading, loadQuota]);

  const thresholds = useMemo(() => ({
    warning: settings?.quotaBatteryWarning ?? 50,
    low: settings?.quotaBatteryLow ?? 10,
  }), [settings?.quotaBatteryWarning, settings?.quotaBatteryLow]);

  const openSettings = (targetId = 'settings-title') => {
    setSettingsOpen(true);
    // The target may only exist after the panel has rendered, so look it up on the next frames.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      (document.getElementById(targetId) ?? document.getElementById('settings-title'))
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };

  const hideAgyClaude = settings?.hideAgyClaude ?? true;

  return (
    <>
      <a className="skip-link" href="#main">{t('app.skip')}</a>
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
            <span>{t('app.loadFailed', { error })}</span>
          </div>
        )}

        <section className="section" data-module="quota" aria-labelledby="quota-title">
          <div className="section-heading">
            <div className="title-row">
              <h2 id="quota-title">{t('quota.title')}</h2>
              <HelpTip text={t('quota.hint')} />
            </div>
            <div className="quota-actions">
              <button type="button" className="circle-btn primary" aria-label={t('quota.add')} title={t('quota.add')} onClick={() => setAddAccount({})}>
                <Icon name="plus" size={16} />
              </button>
              <button type="button" className="circle-btn" aria-label={t('quota.manage')} title={t('quota.manage')} onClick={() => openSettings('account-settings-title')}>
                <Icon name="settings" size={16} />
              </button>
            </div>
          </div>

          {providerList.length === 0 ? (
            <div className="quota-empty">
              <span>{settings ? t('quota.empty') : t('quota.loadingAccounts')}</span>
              {settings && <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddAccount({})}>{t('quota.add')}</button>}
            </div>
          ) : (
            <div className="provider-grid">
              {providerList.map((quota, index) => (
                <QuotaCard
                  key={quota.accountCardId || `${quota.provider}-${index}`}
                  quota={quota}
                  reorder={quota.accountCardId && providerList.length > 1 ? {
                    dragging: dragId === quota.accountCardId,
                    dropTarget: Boolean(dragId) && overId === quota.accountCardId && dragId !== quota.accountCardId,
                    onDragStart: () => setDragId(quota.accountCardId!),
                    onDragOver: () => setOverId(quota.accountCardId!),
                    onDrop: () => {
                      if (dragId) void moveCard(dragId, quota.accountCardId!);
                      setDragId(null);
                      setOverId(null);
                    },
                    onDragEnd: () => { setDragId(null); setOverId(null); },
                    onMove: (delta) => moveCardBy(quota.accountCardId!, delta),
                  } : undefined}
                  includeAgyClaude={!hideAgyClaude}
                  thresholds={thresholds}
                  onEdit={setEditingQuota}
                  onSignIn={(type) => setAddAccount({ type })}
                  onRetry={handleRefresh}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section" data-module="usage" aria-labelledby="overview-title">
          <div className="section-heading">
            <div className="title-row">
              <h2 id="overview-title">{t('overview.title')}</h2>
              <HelpTip text={t('overview.hint')} />
            </div>
            <div className="segmented" role="group" aria-label={t('range.aria')}>
              {RANGES.map((item) => (
                <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => setRange(item.id)}>
                  {t(item.key)}
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
              speed={speed}
            />
          ) : (
            <div className="panel empty">{isLoadingUsage ? t('overview.loading') : t('overview.none')}</div>
          )}
        </section>

        <UsageDetailSection
          models={models}
          clients={clients}
          providers={providers}
          records={records}
          speed={speed}
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
          onAddAccount={(type) => setAddAccount({ type })}
        />
        {addAccount && (
          <AddAccountDialog
            initialType={addAccount.type}
            onClose={() => setAddAccount(null)}
            onAdded={(next) => {
              setSettings(next);
              // The server refreshes quota right after a login; pick the new reading up shortly.
              window.setTimeout(() => loadQuota(), 1500);
            }}
          />
        )}
        <EditAccountDialog
          key={editingQuota?.accountCardId || 'none'}
          quota={editingQuota}
          onClose={() => setEditingQuota(null)}
          onSaved={(next) => setSettings(next)}
        />
      </main>

      <footer className="app-footer">
        <p>{t('app.footer')}</p>
      </footer>
    </>
  );
};
