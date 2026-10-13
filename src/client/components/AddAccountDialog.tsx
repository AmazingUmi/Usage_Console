import React, { useEffect, useState } from 'react';
import type { AccountType, ConsoleSettings } from '../types';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import type { DeviceLoginType } from '../api';
import { addLocalAgyAccount, finishClaudeLogin, pollDeviceLogin, startClaudeLogin, startDeviceLogin } from '../api';
import { useI18n } from '../i18n';

interface AddAccountDialogProps {
  /** Pre-selects the account type, e.g. when signing in from a card that needs it. */
  initialType?: AccountType;
  onClose: () => void;
  onAdded: (settings: ConsoleSettings) => void;
}

const TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

/** Mounted only while open, so every opening starts from a clean state. */
export const AddAccountDialog: React.FC<AddAccountDialogProps> = ({ initialType = 'gpt', onClose, onAdded }) => {
  const { t } = useI18n();
  const [type, setType] = useState<AccountType>(initialType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<{ kind: DeviceLoginType; deviceCode: string; userCode: string; verificationUri: string; interval: number } | null>(null);
  const [claude, setClaude] = useState<{ state: string; authorizeUrl: string } | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!device) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await pollDeviceLogin(device.kind, device.deviceCode);
        if (stopped || !('settings' in result)) return;
        onAdded(result.settings);
        onClose();
      } catch (err) {
        if (!stopped) {
          setError((err as Error).message);
          setDevice(null);
        }
      }
    }, Math.max(3, device.interval) * 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [device, onAdded, onClose]);

  const changeType = (next: AccountType) => {
    setType(next);
    setDevice(null);
    setClaude(null);
    setError(null);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const beginLogin = () => run(async () => {
    if (type === 'gpt' || type === 'grok') setDevice({ kind: type, ...(await startDeviceLogin(type)) });
    else if (type === 'claude') setClaude(await startClaudeLogin());
  });

  const finishClaude = () => run(async () => {
    if (!claude) return;
    const result = await finishClaudeLogin(claude.state, code);
    onAdded(result.settings);
    onClose();
  });

  const addAgy = () => run(async () => {
    const result = await addLocalAgyAccount();
    onAdded(result.settings);
    onClose();
  });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-account-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="add-account-title">{t('add.title')}</h3>
        <p className="hint">{t('add.intro')}</p>
        <label className="field">
          <span className="field-label">{t('add.type')}</span>
          <select className="input" value={type} onChange={(event) => changeType(event.target.value as AccountType)}>
            {TYPES.map((item) => <option key={item} value={item}>{ACCOUNT_TYPE_LABEL[item]}</option>)}
          </select>
        </label>
        {type !== 'agy' && !device && !claude && (
          <button type="button" className="btn btn-primary" onClick={beginLogin} disabled={busy}>
            {busy ? t('add.preparing') : t('add.signIn')}
          </button>
        )}
        {type === 'agy' && (
          <>
            <p className="hint">{t('add.agyInfo')}</p>
            <button type="button" className="btn btn-primary" onClick={addAgy} disabled={busy}>{t('add.agyButton')}</button>
          </>
        )}
        {device && (
          <div className="login-box">
            <p>{t('add.deviceStep')}</p>
            <p className="user-code">{device.userCode}</p>
            <a href={device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a>
            <p className="hint">{t('add.deviceWait')}</p>
          </div>
        )}
        {claude && (
          <div className="login-box">
            <a href={claude.authorizeUrl} target="_blank" rel="noreferrer">{t('add.openClaude')}</a>
            <input className="input" value={code} placeholder={t('add.pasteCode')} onChange={(event) => setCode(event.target.value)} />
            <button type="button" className="btn btn-primary" onClick={finishClaude} disabled={busy || !code.trim()}>{t('add.confirm')}</button>
          </div>
        )}
        {error && <p className="callout" data-tone="danger" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('add.close')}</button>
        </div>
      </div>
    </div>
  );
};
