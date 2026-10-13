import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { QuotaCard } from './components/QuotaCard';
import { OverviewDashboard } from './components/OverviewDashboard';
import { UsageDetailSection } from './components/UsageDetailSection';
import { SettingsPage } from './components/SettingsPage';
import { EditAccountDialog } from './components/EditAccountDialog';
import { AddAccountDialog } from './components/AddAccountDialog';
import { useI18n } from './i18n';
import { fetchQuota, refreshQuota, fetchUsageOverview, fetchSettings, syncUsage, trendDaysFor } from './api';
import { quotaCardsForAccounts } from './lib/providers';
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
} from './types';

const RANGES: Array<{ id: UsageRange; key: string }> = [
  { id: 'today', key: 'range.today' },
  { id: '7d', key: 'range.7d' },
  { id: '30d', key: 'range.30d' },
  { id: 'all', key: 'range.all' },
];

/** Quota is re-read from the server this often; the server itself polls providers every two minutes. */
const QUOTA_POLL_MS = 60 * 1000;

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
    const timer = window.setInterval(() => loadQuota(), QUOTA_POLL_MS);
    return () => window.clearInterval(timer);
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

        <section className="section" aria-labelledby="quota-title">
          <div className="section-heading">
            <div>
              <h2 id="quota-title">{t('quota.title')}</h2>
              <p className="hint">{t('quota.hint')}</p>
            </div>
            <div className="quota-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddAccount({})}>
                <Icon name="plus" size={13} />{t('quota.add')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => openSettings('account-settings-title')}>
                <Icon name="settings" size={13} />{t('quota.manage')}
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
                  key={`${quota.accountCardId || quota.provider}-${index}`}
                  quota={quota}
                  includeAgyClaude={!hideAgyClaude}
                  onEdit={setEditingQuota}
                  onSignIn={(type) => setAddAccount({ type })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="overview-title">
          <div className="section-heading">
            <div>
              <h2 id="overview-title">{t('overview.title')}</h2>
              <p className="hint">{t('overview.hint')}</p>
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
