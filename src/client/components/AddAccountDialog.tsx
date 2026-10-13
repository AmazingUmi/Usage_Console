import React, { useEffect, useState } from 'react';
import type { AccountType, ConsoleSettings } from '../types';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import { finishClaudeLogin, pollGptLogin, startClaudeLogin, startGptLogin } from '../api';

interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (settings: ConsoleSettings) => void;
}

const TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

export const AddAccountDialog: React.FC<AddAccountDialogProps> = ({ open, onClose, onAdded }) => {
  const [type, setType] = useState<AccountType>('gpt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpt, setGpt] = useState<{ deviceCode: string; userCode: string; verificationUri: string } | null>(null);
  const [claude, setClaude] = useState<{ state: string; authorizeUrl: string } | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!open || !gpt) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await pollGptLogin(gpt.deviceCode);
        if (stopped || !('settings' in result)) return;
        onAdded(result.settings);
        onClose();
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [gpt, onAdded, onClose, open]);

  if (!open) return null;

  const beginLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      if (type === 'gpt') setGpt(await startGptLogin());
      else if (type === 'claude') setClaude(await startClaudeLogin());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishClaude = async () => {
    if (!claude) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finishClaudeLogin(claude.state, code);
      onAdded(result.settings);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-account-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="add-account-title">添加账户</h3>
        <p className="hint">本机已登录 Claude Code 时无需在这里添加，刷新后会自动识别。这里用于添加其他订阅账号：令牌只在内存里读取一次额度，不会写入本项目，也不会覆盖 Claude Code 的登录。</p>
        <label className="field">
          <span className="field-label">类型</span>
          <select className="input" value={type} onChange={(event) => setType(event.target.value as AccountType)}>
            {TYPES.map((item) => <option key={item} value={item}>{ACCOUNT_TYPE_LABEL[item]}</option>)}
          </select>
        </label>
        {(type === 'gpt' || type === 'claude') && !gpt && !claude && (
          <button type="button" className="btn btn-primary" onClick={beginLogin} disabled={busy}>
            {busy ? '正在准备…' : '认证登录'}
          </button>
        )}
        {type !== 'gpt' && type !== 'claude' && (
          <p className="hint">Grok 和 AGY 会在重新扫描时从本机登录识别用户 ID，不能在这里另存一份令牌。</p>
        )}
        {gpt && (
          <div className="login-box">
            <p>在浏览器打开验证页，输入代码</p>
            <p className="user-code">{gpt.userCode}</p>
            <a href={gpt.verificationUri} target="_blank" rel="noreferrer">{gpt.verificationUri}</a>
            <p className="hint">等待授权完成，成功后只保存用户 ID。</p>
          </div>
        )}
        {claude && (
          <div className="login-box">
            <a href={claude.authorizeUrl} target="_blank" rel="noreferrer">打开 Claude 登录</a>
            <input className="input" value={code} placeholder="粘贴回调 code" onChange={(event) => setCode(event.target.value)} />
            <button type="button" className="btn btn-primary" onClick={finishClaude} disabled={busy || !code.trim()}>确认身份</button>
          </div>
        )}
        {error && <p className="callout" data-tone="danger" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
};
