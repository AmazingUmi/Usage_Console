import React, { useEffect, useState } from 'react';
import { fetchProxyStatus } from '../api';
import { useI18n } from '../i18n';
import type { ProxyEndpoint, ProxyStatus } from '../types';
import { Icon } from './Icon';
import { ListGroup, ListRow, PaneHead } from './SettingsParts';

interface ProxySettingProps {
  port: number | null;
  onSave: (port: number | null) => Promise<void>;
}

function address(proxy: ProxyEndpoint): string {
  const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
  return `${host}:${proxy.port}`;
}

export const ProxySetting: React.FC<ProxySettingProps> = ({ port, onSave }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState(port === null ? '' : String(port));
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => { setDraft(port === null ? '' : String(port)); }, [port]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const check = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      setChecking(true);
      setCheckError(false);
      try {
        const next = await fetchProxyStatus(controller.signal);
        if (!controller.signal.aborted) setStatus(next);
      } catch {
        if (!controller.signal.aborted) setCheckError(true);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setChecking(false);
      }
    };
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [port, revision]);

  const text = draft.trim();
  const parsed = text === '' ? null : /^\d{1,5}$/.test(text) ? Number(text) : NaN;
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535);
  const dirty = valid && parsed !== port;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(parsed);
      setSaved(true);
      setRevision((value) => value + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const value = (proxy: ProxyEndpoint | null, empty: string) => (proxy
    ? <><code>{address(proxy)}</code><span className="row-tag">{t(`settings.proxy.source.${proxy.source}`)}</span></>
    : <span className="muted-text">{empty}</span>);

  return (
    <>
      <PaneHead icon="globe" title={t('settings.proxy.title')} titleId="proxy-settings-title" description={t('settings.desc.network')}>
        <button type="button" className="btn btn-sm" disabled={checking || saving} onClick={() => setRevision((value) => value + 1)}>
          <Icon name="refresh" size={13} className={checking ? 'is-spinning' : undefined} />
          {checking ? t('settings.proxy.checking') : t('settings.proxy.check')}
        </button>
      </PaneHead>

      <form onSubmit={save}>
        <ListGroup footer={t('settings.proxy.restartHint')}>
          <ListRow title={t('settings.proxy.port')} help={t('settings.proxy.hint')} htmlFor="proxy-port" sub={t('settings.proxy.portSub')}>
            <div className="proxy-control">
              <span className="proxy-host mono">127.0.0.1 :</span>
              <input
                id="proxy-port"
                className="input mono"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('settings.proxy.auto')}
                aria-invalid={!valid}
                value={draft}
                disabled={saving}
                onChange={(event) => { setDraft(event.target.value); setSaved(false); setError(null); }}
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={!dirty || saving}>
                {saving ? t('settings.proxy.saving') : t('edit.save')}
              </button>
            </div>
          </ListRow>
          {status?.detected && Number(text) !== status.detected.port && (
            <ListRow title={t('settings.proxy.detectedPort', { port: status.detected.port })} sub={t(`settings.proxy.source.${status.detected.source}`)}>
              <button type="button" className="btn btn-sm" disabled={saving} onClick={() => { setDraft(String(status.detected!.port)); setSaved(false); }}>
                {t('settings.proxy.useDetected', { port: status.detected.port })}
              </button>
            </ListRow>
          )}
        </ListGroup>
      </form>
      {!valid && <p className="callout pane-status" data-tone="danger" role="alert"><Icon name="alert" size={15} /><span>{t('settings.proxy.invalid')}</span></p>}
      {error && <p className="callout pane-status" data-tone="danger" role="alert"><Icon name="alert" size={15} /><span>{error}</span></p>}
      {saved && <p className="callout pane-status" data-tone="good" role="status"><Icon name="check" size={15} /><span>{t('settings.proxy.saved')}</span></p>}

      <ListGroup label={t('settings.group.connection')}>
        <div aria-live="polite">
          <ListRow title={t('settings.proxy.active')}>
            {status ? value(status.active, t('settings.proxy.direct')) : <span className="muted-text">—</span>}
          </ListRow>
          <ListRow title={t('settings.proxy.detected')}>
            {status ? value(status.detected, t('settings.proxy.notDetected')) : <span className="muted-text">—</span>}
          </ListRow>
          {status?.checkedPort != null && status.listening !== null && (
            <ListRow title={t('settings.proxy.reachability', { port: status.checkedPort })}>
              <span className="pill-status" data-ok={String(status.listening)}>
                {status.listening ? t('settings.proxy.listening') : t('settings.proxy.notListening')}
              </span>
            </ListRow>
          )}
        </div>
      </ListGroup>
      {checkError && <p className="callout pane-status" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.checkFailed')}</span></p>}
      {status?.restartRequired && (
        <div className="callout pane-status" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.restartRequired')}</span></div>
      )}
      {status?.portMismatch && status.detected && (
        <div className="callout pane-status" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.mismatch', { port: status.checkedPort!, detected: status.detected.port })}</span></div>
      )}
      {status?.listening === false && (
        <div className="callout pane-status" data-tone="danger" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.closed', { port: status.checkedPort! })}</span></div>
      )}
    </>
  );
};
