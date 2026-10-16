import React, { useEffect, useState } from 'react';
import { fetchProxyStatus } from '../api';
import { useI18n } from '../i18n';
import type { ProxyEndpoint, ProxyStatus } from '../types';
import { HelpTip } from './HelpTip';
import { Icon } from './Icon';

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

  return (
    <section className="panel settings-card" aria-labelledby="proxy-settings-title">
      <div className="panel-head">
        <div className="title-row">
          <h3 id="proxy-settings-title">{t('settings.proxy.title')}</h3>
          <HelpTip text={t('settings.proxy.hint')} />
        </div>
        <button type="button" className="btn btn-sm" disabled={checking || saving} onClick={() => setRevision((value) => value + 1)}>
          {checking ? t('settings.proxy.checking') : t('settings.proxy.check')}
        </button>
      </div>
      <div className="panel-body">
        <form className="block proxy-block" onSubmit={save}>
          <label className="field-label" htmlFor="proxy-port">{t('settings.proxy.port')}</label>
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
              aria-describedby="proxy-port-hint"
              aria-invalid={!valid}
              value={draft}
              disabled={saving}
              onChange={(event) => { setDraft(event.target.value); setSaved(false); setError(null); }}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!dirty || saving}>
              {saving ? t('settings.proxy.saving') : t('edit.save')}
            </button>
            {status?.detected && Number(text) !== status.detected.port && (
              <button type="button" className="btn btn-sm" disabled={saving} onClick={() => { setDraft(String(status.detected!.port)); setSaved(false); }}>
                {t('settings.proxy.useDetected', { port: status.detected.port })}
              </button>
            )}
          </div>
          <p id="proxy-port-hint" className="hint">{t('settings.proxy.restartHint')}</p>
          {!valid && <p className="proxy-error" role="alert">{t('settings.proxy.invalid')}</p>}
          {error && <p className="proxy-error" role="alert">{error}</p>}
          {saved && <p className="hint" role="status">{t('settings.proxy.saved')}</p>}

          {status && (
            <dl className="kv proxy-status" aria-live="polite">
              <dt>{t('settings.proxy.active')}</dt>
              <dd>{status.active
                ? <><code>{address(status.active)}</code><span className="hint"> · {t(`settings.proxy.source.${status.active.source}`)}</span></>
                : t('settings.proxy.direct')}</dd>
              <dt>{t('settings.proxy.detected')}</dt>
              <dd>{status.detected
                ? <><code>{address(status.detected)}</code><span className="hint"> · {t(`settings.proxy.source.${status.detected.source}`)}</span></>
                : t('settings.proxy.notDetected')}</dd>
              {status.checkedPort !== null && status.listening !== null && (
                <>
                  <dt>{t('settings.proxy.reachability', { port: status.checkedPort })}</dt>
                  <dd className="ready" data-ready={String(status.listening)}>
                    {status.listening ? t('settings.proxy.listening') : t('settings.proxy.notListening')}
                  </dd>
                </>
              )}
            </dl>
          )}
          {checkError && <p className="hint" role="status">{t('settings.proxy.checkFailed')}</p>}
          {status?.restartRequired && (
            <div className="callout" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.restartRequired')}</span></div>
          )}
          {status?.portMismatch && status.detected && (
            <div className="callout" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.mismatch', { port: status.checkedPort!, detected: status.detected.port })}</span></div>
          )}
          {status?.listening === false && (
            <div className="callout" data-tone="danger" role="status"><Icon name="alert" size={15} /><span>{t('settings.proxy.closed', { port: status.checkedPort! })}</span></div>
          )}
        </form>
      </div>
    </section>
  );
};
