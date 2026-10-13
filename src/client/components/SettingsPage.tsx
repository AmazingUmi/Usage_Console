import React, { useEffect, useMemo, useState } from 'react';
import type { AccountType, ConsoleSettings, PathSettings, QuotaState, ScanSourceStatus } from '../types';
import { calibrateData, deleteAccount, saveSettings } from '../api';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import type { Lang } from '../i18n';
import { useI18n } from '../i18n';
import { BatteryThresholdSlider } from './BatteryThresholdSlider';
import { RefreshIntervalSetting } from './RefreshIntervalSetting';
import { Icon } from './Icon';

interface SettingsPageProps {
  open: boolean;
  onToggle: () => void;
  settings: ConsoleSettings | null;
  onSaved: (settings: ConsoleSettings, quota?: QuotaState | null) => void;
  onAddAccount: (type?: AccountType) => void;
}

const PATH_KEYS: Array<keyof PathSettings> = ['codexDir', 'piAgentDir', 'claudeProjectsDir', 'grokSessionsDir'];
const LANGS: Lang[] = ['zh', 'en'];
/** Types that read quota through a login held by this console. */
const LOGIN_TYPES = new Set<AccountType>(['gpt', 'claude', 'grok']);

function samePaths(a: PathSettings, b: PathSettings): boolean {
  return PATH_KEYS.every((key) => a[key].trim() === b[key].trim());
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ open, onToggle, settings, onSaved, onAddAccount }) => {
  const { t, lang, setLang, locale } = useI18n();
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

  return (
    <section className="section" aria-labelledby="settings-title">
      <div className="section-heading">
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
        {!open && <p className="hint">{t('settings.collapsedHint')}</p>}
      </div>

      {open && (
        <>
          {message && <div className="callout" data-tone="good" role="status" style={{ marginBottom: 14 }}><Icon name="check" size={15} /><span>{message}</span></div>}
          {error && <div className="callout" data-tone="danger" role="alert" style={{ marginBottom: 14 }}><Icon name="alert" size={15} /><span>{error}</span></div>}
          {!settings || !draft ? (
            <div className="panel empty">{t('settings.loading')}</div>
          ) : (
            <div id="settings-panel" className="settings-grid">
              <section className="panel settings-card" aria-labelledby="account-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="account-settings-title">{t('settings.accounts')}</h3>
                    <p className="hint">{t('settings.accountsHint')}</p>
                  </div>
                  <div className="row-wrap">
                    <button type="button" className="btn btn-sm" onClick={calibrate} disabled={calibrating}>
                      {calibrating ? t('settings.scanning') : t('settings.rescan')}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => onAddAccount()}>
                      <Icon name="plus" size={13} />{t('settings.add')}
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  <ul className="account-list">
                    {accounts.map((account) => {
                      const needsLogin = LOGIN_TYPES.has(account.type);
                      return (
                        <li key={account.id}>
                          <span className="chip">{ACCOUNT_TYPE_LABEL[account.type]}</span>
                          <div className="grow">
                            <strong>{account.label || account.email || ACCOUNT_TYPE_LABEL[account.type]}</strong>
                            {needsLogin && (
                              <span className="badge" data-tone={account.ownLogin ? 'good' : 'muted'} style={{ marginLeft: 8 }}>
                                {account.ownLogin ? t('settings.ownLogin') : t('settings.needLogin')}
                              </span>
                            )}
                            <p className="hint" title={account.userId}>
                              {account.email && account.label ? `${account.email} · ` : ''}{account.userId || t('settings.unknownId')}
                            </p>
                          </div>
                          {needsLogin && (
                            <button type="button" className="btn btn-sm" onClick={() => onAddAccount(account.type)}>
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
                        </li>
                      );
                    })}
                    {accounts.length === 0 && <li className="hint">{t('settings.noAccounts')}</li>}
                  </ul>
                </div>
              </section>

              <section className="panel settings-card" aria-labelledby="display-settings-title">
                <div className="panel-head">
                  <h3 id="display-settings-title">{t('settings.display')}</h3>
                </div>
                <div className="panel-body">
                  <div className="row">
                    <div>
                      <strong>{t('settings.language')}</strong>
                      <p className="hint">{t('settings.languageHint')}</p>
                    </div>
                    <div className="segmented" role="group" aria-label={t('settings.language')}>
                      {LANGS.map((item) => (
                        <button key={item} type="button" aria-pressed={lang === item} onClick={() => setLang(item)}>
                          {t(`settings.lang.${item}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">{t('settings.battery.title')}</span>
                    <BatteryThresholdSlider
                      value={{ warning: settings.quotaBatteryWarning, low: settings.quotaBatteryLow }}
                      onCommit={(next) => run(() => saveDisplay({ quotaBatteryWarning: next.warning, quotaBatteryLow: next.low }))}
                    />
                    <span className="hint">{t('settings.battery.hint')}</span>
                    <span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={settings.quotaBatteryWarning === 50 && settings.quotaBatteryLow === 10}
                        onClick={() => run(() => saveDisplay({ quotaBatteryWarning: 50, quotaBatteryLow: 10 }))}
                      >
                        {t('settings.battery.reset')}
                      </button>
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-label">{t('settings.refresh.title')}</span>
                    <RefreshIntervalSetting
                      seconds={settings.quotaRefreshIntervalSeconds}
                      onSave={(seconds) => saveDisplay({ quotaRefreshIntervalSeconds: seconds })}
                    />
                    <span className="hint">{t('settings.refresh.hint')}</span>
                  </div>
                  <div className="row">
                    <div>
                      <strong>{t('settings.hideAgy')}</strong>
                      <p className="hint">{t('settings.hideAgyHint')}</p>
                    </div>
                    <button
                      type="button"
                      className="switch"
                      role="switch"
                      aria-checked={hideAgyClaude}
                      aria-label={t('settings.hideAgy')}
                      disabled={savingHide}
                      onClick={() => saveHide(!hideAgyClaude)}
                    />
                  </div>
                </div>
              </section>

              <section className="panel settings-card span-2" aria-labelledby="path-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="path-settings-title">{t('settings.paths')}</h3>
                    <p className="hint">{t('settings.pathsHint')}</p>
                  </div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={savePaths} disabled={savingPaths || !dirty}>
                    {savingPaths ? t('settings.saving') : t('settings.saveRescan')}
                  </button>
                </div>
                <div className="panel-body">
                  <label className="field">
                    <span className="field-label">{t('settings.dataDir')}</span>
                    <input className="input mono" value={dataDir} spellCheck={false} onChange={(event) => setDataDir(event.target.value)} />
                    <span className="hint">{t('settings.dataDirHint')}</span>
                  </label>
                  {PATH_KEYS.map((key) => {
                    const ready = settings.availability[key];
                    const effective = key === 'claudeProjectsDir' && settings.claudeProjectsAll?.length
                      ? settings.claudeProjectsAll.join(lang === 'zh' ? '，' : ', ')
                      : settings.resolved[key];
                    return (
                      <label key={key} className="field">
                        <span className="field-label">
                          {t(`path.${key}`)}
                          <span className="ready" data-ready={ready ? 'true' : 'false'}>{ready ? t('settings.found') : t('settings.notFound')}</span>
                        </span>
                        <span className="path-control">
                          <input
                            className="input mono"
                            value={draft[key]}
                            spellCheck={false}
                            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                          />
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setDraft({ ...draft, [key]: settings.defaults[key] })}
                            disabled={draft[key] === settings.defaults[key]}
                          >
                            {t('settings.restoreDefault')}
                          </button>
                        </span>
                        <span className="hint">{t(`path.${key}Hint`)}</span>
                        {effective !== draft[key].trim() && <span className="hint">{t('settings.actualScan')}<code>{effective}</code></span>}
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="panel settings-card" aria-labelledby="scan-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="scan-settings-title">{t('settings.scan')}</h3>
                    <p className="hint">
                      {t('settings.scanCount', { n: settings.scan.recordCount.toLocaleString(locale) })}
                      {settings.scan.lastSyncTime ? ` · ${new Date(settings.scan.lastSyncTime).toLocaleString(locale)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="panel-body">
                  <ul className="scan-list">
                    {settings.scan.sources.map((source) => {
                      const note = sourceNote(source);
                      return (
                        <li key={source.id}>
                          <div className="row">
                            <strong>{t(`scan.src.${source.id}`) === `scan.src.${source.id}` ? source.label : t(`scan.src.${source.id}`)}</strong>
                            <span className="hint">
                              {source.exists
                                ? t('settings.scanFiles', { files: source.filesScanned, records: source.records.toLocaleString(locale) })
                                : t('settings.dirMissing')}
                            </span>
                          </div>
                          <code>{source.path}</code>
                          {note && <span className="hint">{note}</span>}
                        </li>
                      );
                    })}
                    {settings.scan.sources.length === 0 && <li className="hint">{t('settings.scanNone')}</li>}
                  </ul>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
};
