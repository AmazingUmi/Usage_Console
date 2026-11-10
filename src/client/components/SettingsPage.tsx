import React, { useEffect, useMemo, useState } from 'react';
import type { AccountType, ConsoleSettings, PathSettings, QuotaState, ScanSourceStatus } from '../types';
import { calibrateData, deleteAccount, saveSettings } from '../api';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import type { Lang } from '../i18n';
import { useI18n } from '../i18n';
import { BatteryThresholdSlider } from './BatteryThresholdSlider';
import { RefreshIntervalSetting } from './RefreshIntervalSetting';
import { ProxySetting } from './ProxySetting';
import { HelpTip } from './HelpTip';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { ListGroup, ListRow, PaneHead, SettingsGlyph } from './SettingsParts';

interface SettingsPageProps {
  open: boolean;
  onToggle: () => void;
  settings: ConsoleSettings | null;
  onSaved: (settings: ConsoleSettings, quota?: QuotaState | null) => void;
  onAddAccount: (type?: AccountType) => void;
  /** Asks the panel to show a pane (e.g. "manage accounts" on the quota module); `at` makes repeats count. */
  paneRequest?: { pane: SettingsPane; at: number } | null;
}

const PATH_KEYS: Array<keyof PathSettings> = [
  'codexDir',
  'piAgentDir',
  'claudeProjectsDir',
  'grokSessionsDir',
  'antigravityDir',
];
const LANGS: Lang[] = ['zh', 'en'];
/** Types that read quota through a login held by this console. */
const LOGIN_TYPES = new Set<AccountType>(['gpt', 'claude', 'grok']);

/** Account avatars reuse the provider colours of the quota cards. */
const TYPE_VISUAL: Record<AccountType, { color: string; letter: string }> = {
  gpt: { color: 'var(--p-codex)', letter: 'O' },
  claude: { color: 'var(--p-claude)', letter: 'C' },
  grok: { color: 'var(--p-grok)', letter: 'G' },
  agy: { color: 'var(--p-agy)', letter: 'A' },
};

export type SettingsPane = 'accounts' | 'display' | 'network' | 'data' | 'scan';
type Pane = SettingsPane;

const PANES: Array<{ id: Pane; icon: IconName; titleKey: string }> = [
  { id: 'accounts', icon: 'user', titleKey: 'settings.accounts' },
  { id: 'display', icon: 'monitor', titleKey: 'settings.display' },
  { id: 'network', icon: 'globe', titleKey: 'settings.proxy.title' },
  { id: 'data', icon: 'folder', titleKey: 'settings.paths' },
  { id: 'scan', icon: 'activity', titleKey: 'settings.scan' },
];

function samePaths(a: PathSettings, b: PathSettings): boolean {
  return PATH_KEYS.every((key) => a[key].trim() === b[key].trim());
}

function compactCount(n: number, locale: string): string {
  return n >= 10_000 ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n) : n.toLocaleString(locale);
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ open, onToggle, settings, onSaved, onAddAccount, paneRequest }) => {
  const { t, lang, setLang, locale } = useI18n();
  const [pane, setPane] = useState<Pane>('accounts');
  useEffect(() => { if (paneRequest) setPane(paneRequest.pane); }, [paneRequest]);
  const [draft, setDraft] = useState<PathSettings | null>(settings?.paths ?? null);
  const [savingPaths, setSavingPaths] = useState(false);
  const [savingHide, setSavingHide] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setDraft(settings.paths);
      setDataDir(settings.dataDir || '');
    }
  }, [settings]);

  // A status message belongs to the pane it came from.
  useEffect(() => { setMessage(null); setError(null); }, [pane]);

  const dirty = useMemo(() => {
    if (!settings || !draft) return false;
    return !samePaths(draft, settings.paths) || dataDir.trim() !== (settings.dataDir || '').trim();
  }, [draft, dataDir, settings]);

  const run = async (task: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveHide = (hideAgyClaude: boolean) => run(async () => {
    setSavingHide(true);
    try {
      const result = await saveSettings({ hideAgyClaude });
      onSaved(result.settings, result.quota);
    } finally {
      setSavingHide(false);
    }
  });

  /** Display preferences save as soon as they change; a failure is shown and the control snaps back. */
  const saveDisplay = async (patch: Parameters<typeof saveSettings>[0]) => {
    setError(null);
    const result = await saveSettings(patch);
    onSaved(result.settings, result.quota);
  };

  const savePaths = () => run(async () => {
    if (!draft) return;
    setSavingPaths(true);
    try {
      const result = await saveSettings({ paths: draft, dataDir, rescan: true });
      onSaved(result.settings, result.quota);
      setMessage(t('settings.pathsSaved'));
    } finally {
      setSavingPaths(false);
    }
  });

  const calibrate = () => run(async () => {
    setCalibrating(true);
    try {
      const result = await calibrateData();
      onSaved(result.settings);
      setMessage(t('settings.rescanned', { n: result.count.toLocaleString(locale) }));
    } finally {
      setCalibrating(false);
    }
  });

  const sourceNote = (source: ScanSourceStatus): string | undefined => {
    if (!source.noteCodes?.length) return source.note;
    return source.noteCodes.map((code) => {
      const [name, n] = code.split(':');
      return t(`scan.note.${name}`, { n: n ?? '' });
    }).join(lang === 'zh' ? '；' : '; ');
  };

  const hideAgyClaude = settings?.hideAgyClaude ?? true;
  const accounts = settings?.accounts ?? [];
  const found = settings ? PATH_KEYS.filter((key) => settings.availability[key]).length : 0;

  const navMeta: Record<Pane, string> = {
    accounts: String(accounts.length),
    display: t(`settings.lang.${lang}`),
    network: settings?.proxyPort ? `:${settings.proxyPort}` : t('settings.nav.auto'),
    data: `${found}/${PATH_KEYS.length}`,
    scan: settings ? compactCount(settings.scan.recordCount, locale) : '',
  };

  const rescanButton = (
    <button type="button" className="btn btn-sm" onClick={calibrate} disabled={calibrating}>
      <Icon name="refresh" size={13} className={calibrating ? 'is-spinning' : undefined} />
      {calibrating ? t('settings.scanning') : t('settings.rescan')}
    </button>
  );

  const status = (message || error) && (
    <div className="callout pane-status" data-tone={error ? 'danger' : 'good'} role={error ? 'alert' : 'status'}>
      <Icon name={error ? 'alert' : 'check'} size={15} />
      <span>{error || message}</span>
    </div>
  );

  const renderPane = (s: ConsoleSettings, paths: PathSettings) => {
    switch (pane) {
      case 'accounts':
        return (
          <>
            <PaneHead icon="user" title={t('settings.accounts')} titleId="account-settings-title" description={t('settings.accountsHint')}>
              {rescanButton}
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onAddAccount()}>
                <Icon name="plus" size={13} />{t('settings.add')}
              </button>
            </PaneHead>
            {status}
            <ListGroup>
              {accounts.map((account) => {
                const needsLogin = LOGIN_TYPES.has(account.type);
                const visual = TYPE_VISUAL[account.type];
                return (
                  <ListRow
                    key={account.id}
                    lead={<span className="account-avatar" style={{ '--pc': visual.color } as React.CSSProperties} aria-hidden="true">{visual.letter}</span>}
                    title={account.label || account.email || ACCOUNT_TYPE_LABEL[account.type]}
                    sub={<>
                      <span className="row-tag">{ACCOUNT_TYPE_LABEL[account.type]}</span>
                      {account.email && account.label ? `${account.email} · ` : ''}{account.userId || t('settings.unknownId')}
                    </>}
                  >
                    <span className="badge" data-tone={!needsLogin ? 'accent' : account.ownLogin ? 'good' : 'muted'}>
                      {!needsLogin ? t('settings.localLogin') : account.ownLogin ? t('settings.ownLogin') : t('settings.needLogin')}
                    </span>
                    {needsLogin && (
                      <button type="button" className={`btn btn-sm${account.ownLogin ? '' : ' btn-primary'}`} onClick={() => onAddAccount(account.type)}>
                        {account.ownLogin ? t('settings.relogin') : t('settings.login')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost btn-danger"
                      onClick={() => run(async () => onSaved((await deleteAccount(account.id)).settings))}
                    >
                      {t('settings.remove')}
                    </button>
                  </ListRow>
                );
              })}
              {accounts.length === 0 && <p className="list-empty">{t('settings.noAccounts')}</p>}
            </ListGroup>
          </>
        );

      case 'display':
        return (
          <>
            <PaneHead icon="monitor" title={t('settings.display')} titleId="display-settings-title" description={t('settings.desc.display')} />
            {status}
            <ListGroup>
              <ListRow title={t('settings.language')} sub={t('settings.languageHint')}>
                <div className="segmented" role="group" aria-label={t('settings.language')}>
                  {LANGS.map((item) => (
                    <button key={item} type="button" aria-pressed={lang === item} onClick={() => setLang(item)}>
                      {t(`settings.lang.${item}`)}
                    </button>
                  ))}
                </div>
              </ListRow>
              <ListRow title={t('settings.refresh.title')} help={t('settings.refresh.hint')} sub={t('settings.refresh.sub')}>
                <RefreshIntervalSetting
                  seconds={s.quotaRefreshIntervalSeconds}
                  onSave={(seconds) => saveDisplay({ quotaRefreshIntervalSeconds: seconds })}
                />
              </ListRow>
              <ListRow title={t('settings.hideAgy')} sub={t('settings.hideAgyHint')}>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={hideAgyClaude}
                  aria-label={t('settings.hideAgy')}
                  disabled={savingHide}
                  onClick={() => saveHide(!hideAgyClaude)}
                />
              </ListRow>
            </ListGroup>
            <ListGroup
              label={<span className="label-row">{t('settings.battery.title')}<HelpTip text={t('settings.battery.hint')} /></span>}
              aside={(
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={s.quotaBatteryWarning === 50 && s.quotaBatteryLow === 10}
                  onClick={() => run(() => saveDisplay({ quotaBatteryWarning: 50, quotaBatteryLow: 10 }))}
                >
                  {t('settings.battery.reset')}
                </button>
              )}
            >
              <div className="list-row" data-stacked="">
                <BatteryThresholdSlider
                  value={{ warning: s.quotaBatteryWarning, low: s.quotaBatteryLow }}
                  onCommit={(next) => run(() => saveDisplay({ quotaBatteryWarning: next.warning, quotaBatteryLow: next.low }))}
                />
              </div>
            </ListGroup>
          </>
        );

      case 'network':
        return <ProxySetting port={s.proxyPort ?? null} onSave={(proxyPort) => saveDisplay({ proxyPort })} />;

      case 'data':
        return (
          <>
            <PaneHead icon="folder" title={t('settings.paths')} titleId="path-settings-title" description={t('settings.desc.data')}>
              <button type="button" className="btn btn-sm btn-primary" onClick={savePaths} disabled={savingPaths || !dirty}>
                {savingPaths ? t('settings.saving') : t('settings.saveRescan')}
              </button>
            </PaneHead>
            {status}
            <ListGroup label={t('settings.group.storage')}>
              <ListRow stacked title={t('settings.dataDir')} help={t('settings.dataDirHint')} htmlFor="data-dir">
                <input id="data-dir" className="input mono" value={dataDir} spellCheck={false} onChange={(event) => setDataDir(event.target.value)} />
              </ListRow>
            </ListGroup>
            <ListGroup label={t('settings.group.sources')} footer={t('settings.pathsHint')}>
              {PATH_KEYS.map((key) => {
                const ready = s.availability[key];
                const effective = key === 'claudeProjectsDir' && s.claudeProjectsAll?.length
                  ? s.claudeProjectsAll.join(lang === 'zh' ? '，' : ', ')
                  : key === 'antigravityDir' && s.antigravityBrainAll?.length
                    ? s.antigravityBrainAll.join(lang === 'zh' ? '，' : ', ')
                    : s.resolved[key];
                return (
                  <ListRow
                    key={key}
                    stacked
                    title={t(`path.${key}`)}
                    help={t(`path.${key}Hint`)}
                    htmlFor={`path-${key}`}
                    aside={<>
                      {paths[key] !== s.defaults[key] && (
                        <button type="button" className="text-link" onClick={() => setDraft({ ...paths, [key]: s.defaults[key] })}>
                          {t('settings.restoreDefault')}
                        </button>
                      )}
                      <span className="pill-status" data-ok={ready ? 'true' : 'false'}>{ready ? t('settings.found') : t('settings.notFound')}</span>
                    </>}
                  >
                    <input
                      id={`path-${key}`}
                      className="input mono"
                      value={paths[key]}
                      spellCheck={false}
                      onChange={(event) => setDraft({ ...paths, [key]: event.target.value })}
                    />
                    {effective !== paths[key].trim() && <span className="row-sub">{t('settings.actualScan')}<code>{effective}</code></span>}
                  </ListRow>
                );
              })}
            </ListGroup>
          </>
        );

      case 'scan':
        return (
          <>
            <PaneHead icon="activity" title={t('settings.scan')} titleId="scan-settings-title" description={t('settings.desc.scan')}>
              {rescanButton}
            </PaneHead>
            {status}
            <div className="scan-hero">
              <div>
                <strong>{s.scan.recordCount.toLocaleString(locale)}</strong>
                <span>{t('settings.scanRecords')}</span>
              </div>
              <div>
                <strong>{s.scan.sources.filter((source) => source.exists).length}<small>/{s.scan.sources.length}</small></strong>
                <span>{t('settings.scanSources')}</span>
              </div>
              <div>
                <strong className="scan-time">{s.scan.lastSyncTime ? new Date(s.scan.lastSyncTime).toLocaleTimeString(locale) : '—'}</strong>
                <span>{s.scan.lastSyncTime ? new Date(s.scan.lastSyncTime).toLocaleDateString(locale) : t('settings.scanNone')}</span>
              </div>
            </div>
            <ListGroup>
              {s.scan.sources.map((source) => {
                const note = sourceNote(source);
                const name = t(`scan.src.${source.id}`) === `scan.src.${source.id}` ? source.label : t(`scan.src.${source.id}`);
                return (
                  <ListRow
                    key={source.id}
                    lead={<i className="source-dot" data-ok={source.exists ? 'true' : 'false'} aria-hidden="true" />}
                    title={name}
                    sub={<><code title={source.path}>{source.path}</code>{note && <span className="row-note">{note}</span>}</>}
                  >
                    <span className="scan-figure" data-muted={source.exists ? undefined : ''}>
                      {source.exists
                        ? t('settings.scanFiles', { files: source.filesScanned, records: source.records.toLocaleString(locale) })
                        : t('settings.dirMissing')}
                    </span>
                  </ListRow>
                );
              })}
              {s.scan.sources.length === 0 && <p className="list-empty">{t('settings.scanNone')}</p>}
            </ListGroup>
          </>
        );
    }
  };

  return (
    <section className="section" data-module="settings" aria-labelledby="settings-title">
      <div className="section-heading">
        <div className="title-row">
          <button
            type="button"
            className="settings-toggle"
            aria-expanded={open}
            aria-controls="settings-panel"
            onClick={onToggle}
          >
            <Icon name="chevron" size={16} />
            <h2 id="settings-title">{t('settings.title')}</h2>
          </button>
          <HelpTip text={t('settings.collapsedHint')} />
        </div>
      </div>

      {open && (
        !settings || !draft ? (
          <div className="panel empty">{t('settings.loading')}</div>
        ) : (
          <div id="settings-panel" className="settings-shell">
            <nav className="panel settings-nav" aria-label={t('settings.nav.aria')}>
              {PANES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={pane === item.id ? 'page' : undefined}
                  onClick={() => setPane(item.id)}
                >
                  <SettingsGlyph icon={item.icon} />
                  <span className="nav-label">{t(item.titleKey)}</span>
                  <span className="nav-meta">{navMeta[item.id]}</span>
                </button>
              ))}
            </nav>
            <div className="settings-pane" key={pane}>
              {renderPane(settings, draft)}
            </div>
          </div>
        )
      )}
    </section>
  );
};
