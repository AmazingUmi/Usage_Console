import React, { useEffect, useMemo, useState } from 'react';
import type { AccountType, ConsoleAccount, ConsoleSettings, PathSettings, QuotaState } from '../types';
import { calibrateData, deleteAccount, saveSettings } from '../api';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import { AddAccountDialog } from './AddAccountDialog';

interface SettingsPageProps {
  open: boolean;
  onToggle: () => void;
  settings: ConsoleSettings | null;
  onSaved: (settings: ConsoleSettings, quota?: QuotaState | null) => void;
}

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

const PATH_FIELDS: Array<{ key: keyof PathSettings; label: string; hint: string }> = [
  {
    key: 'codexDir',
    label: 'Codex 目录',
    hint: '读取 sessions/ 会话用量，以及 auth.json 里的额度凭据。',
  },
  {
    key: 'piAgentDir',
    label: 'Pi Agent 目录',
    hint: '读取 sessions/ 会话和额度缓存。不再读取 Pi 用量账本，避免和会话重复计数。',
  },
  {
    key: 'claudeProjectsDir',
    label: 'Claude 对话目录',
    hint: '扫描 Claude Code 的 projects JSONL，包含子代理和 Workflow 会话。填写 ~/.claude 时会自动使用其中的 projects。',
  },
  {
    key: 'grokSessionsDir',
    label: 'Grok 会话目录',
    hint: '读取 Grok Build 的 updates.jsonl。',
  },
];

function samePaths(a: PathSettings, b: PathSettings): boolean {
  return PATH_FIELDS.every(({ key }) => a[key].trim() === b[key].trim());
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ open, onToggle, settings, onSaved }) => {
  const [draft, setDraft] = useState<PathSettings | null>(settings?.paths ?? null);
  const [savingPaths, setSavingPaths] = useState(false);
  const [savingHide, setSavingHide] = useState(false);
  const [savingAccounts, setSavingAccounts] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
    return !samePaths(draft, settings.paths);
  }, [draft, settings]);

  const updatePath = (key: keyof PathSettings, value: string) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setMessage(null);
    setError(null);
  };

  const saveHide = async (hideAgyClaude: boolean) => {
    setSavingHide(true);
    setError(null);
    try {
      const result = await saveSettings({ hideAgyClaude });
      onSaved(result.settings, result.quota);
      setMessage(hideAgyClaude ? '已隐藏 Antigravity 的 Claude 额度分组' : '已显示 Antigravity 的 Claude 额度分组');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingHide(false);
    }
  };

  const savePaths = async () => {
    if (!draft) return;
    setSavingPaths(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveSettings({ paths: draft, dataDir, rescan: true });
      onSaved(result.settings, result.quota);
      setMessage('路径已保存，并重新扫描了本地用量');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPaths(false);
    }
  };

  const hideAgyClaude = settings?.hideAgyClaude ?? true;
  const accounts = settings?.accounts ?? [];

  return (
    <section className="section settings-section" aria-labelledby="settings-title">
      <div className="section-heading">
        <h2 id="settings-title">
          <button
            type="button"
            className="settings-heading-btn"
            aria-expanded={open}
            aria-controls="settings-panel"
            onClick={onToggle}
          >
            设置
            <span>{open ? '隐藏' : '开启'}</span>
          </button>
        </h2>
        <details className="info-help">
          <summary aria-label="设置说明">?</summary>
          <div className="help-content">
            <strong>显示与扫描路径</strong>
            <p>点击标题或顶栏「设置」可展开或收起。未添加的账户不会出现在额度区。</p>
          </div>
        </details>
      </div>

      {open && (!settings || !draft ? (
        <div className="panel loading-panel">
          <p className="hint">正在读取设置…</p>
        </div>
      ) : (
        <div id="settings-panel" className="settings-grid">
          <section className="panel settings-card" aria-labelledby="account-settings-title">
            <div className="title-row">
              <h3 id="account-settings-title">账户</h3>
              <details className="info-help">
                <summary aria-label="账户说明">?</summary>
                <div className="help-content">
                  <strong>按类型添加</strong>
                  <p>选择 GPT、Claude、Grok 或 AGY 后添加。只有已添加的账户会显示额度卡，未添加的类型不占位。</p>
                </div>
              </details>
            </div>
            <ul className="account-list">
              {accounts.map((account) => (
                <li key={account.id}>
                  <div>
                    <strong>{account.label || ACCOUNT_TYPE_LABEL[account.type]}</strong>
                    <span>{ACCOUNT_TYPE_LABEL[account.type]} · {account.userId || '未识别 ID'}</span>
                    {account.notes && <p className="hint">{account.notes}</p>}
                  </div>
                  <button type="button" onClick={() => deleteAccount(account.id).then((result) => onSaved(result.settings)).catch((err) => setError((err as Error).message))}>
                    移除
                  </button>
                </li>
              ))}
              {accounts.length === 0 && <li className="hint">打开控制台时会自动识别本机已登录账户。也可以手动添加。</li>}
            </ul>
            <div className="account-add">
              <button type="button" className="button-primary" onClick={() => setAddOpen(true)}>添加账户</button>
              <button
                type="button"
                disabled={savingAccounts}
                onClick={async () => {
                  setSavingAccounts(true);
                  setError(null);
                  try {
                    const result = await calibrateData();
                    onSaved(result.settings);
                    setMessage(`已重新扫描校准，共 ${result.count.toLocaleString()} 条用量`);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setSavingAccounts(false);
                  }
                }}
              >
                {savingAccounts ? '正在校准…' : '重新扫描校准'}
              </button>
            </div>
          </section>

          <section className="panel settings-card" aria-labelledby="display-settings-title">
            <div className="title-row">
              <h3 id="display-settings-title">显示</h3>
            </div>
            <div className="settings-row">
              <div>
                <strong>隐藏 AGY Claude 额度</strong>
                <p className="hint">只隐藏 Antigravity 额度卡中的 Claude 分组，不改变用量统计与显示。</p>
              </div>
              <button
                type="button"
                className={`settings-switch${hideAgyClaude ? ' active' : ''}`}
                aria-pressed={hideAgyClaude}
                disabled={savingHide}
                onClick={() => saveHide(!hideAgyClaude)}
              >
                <i />
                {hideAgyClaude ? '已隐藏' : '显示中'}
              </button>
            </div>
          </section>

          <section className="panel settings-card" aria-labelledby="path-settings-title">
            <div className="settings-card-head">
              <div className="title-row">
                <h3 id="path-settings-title">扫描路径</h3>
                <details className="info-help">
                  <summary aria-label="路径说明">?</summary>
                  <div className="help-content">
                    <strong>本地路径</strong>
                    <p>留空或与默认值相同会恢复默认目录。支持 ~ 开头。保存后会按新路径重新扫描用量和额度缓存。</p>
                  </div>
                </details>
              </div>
              <button type="button" className="button-primary" onClick={savePaths} disabled={savingPaths || !dirty}>
                {savingPaths ? '正在扫描…' : '保存并重新扫描'}
              </button>
            </div>

            <label className="path-field">
              <span className="path-label">数据目录</span>
              <span className="path-control">
                <input className="settings-input" value={dataDir} spellCheck={false} onChange={(event) => setDataDir(event.target.value)} />
              </span>
              <span className="hint">账户卡片和用量账本写在这里。只保存用户 ID 与用量，不保存 OAuth 令牌。</span>
            </label>
            <div className="path-list">
              {PATH_FIELDS.map((field) => {
                const effective = settings.resolved[field.key];
                const ready = settings.availability[field.key];
                const customized = draft[field.key].trim() !== settings.defaults[field.key];
                return (
                  <label key={field.key} className="path-field">
                    <span className="path-label">
                      {field.label}
                      <em data-ready={ready ? 'true' : 'false'}>{ready ? '目录存在' : '未找到目录'}</em>
                    </span>
                    <span className="path-control">
                      <input
                        className="settings-input"
                        value={draft[field.key]}
                        spellCheck={false}
                        onChange={(event) => updatePath(field.key, event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => updatePath(field.key, settings.defaults[field.key])}
                        disabled={!customized && draft[field.key] === settings.defaults[field.key]}
                      >
                        恢复默认
                      </button>
                    </span>
                    <span className="hint">{field.hint}</span>
                    {effective !== draft[field.key].trim() && (
                      <span className="hint">生效路径：{effective}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel settings-card" aria-labelledby="scan-settings-title">
            <div className="title-row">
              <h3 id="scan-settings-title">最近扫描</h3>
              <details className="info-help">
                <summary aria-label="扫描说明">?</summary>
                <div className="help-content">
                  <strong>Claude 对话</strong>
                  <p>读取本地 Claude Code 对话 JSONL。同一条消息的流式快照会按 message id 去重，避免重复计入用量。</p>
                </div>
              </details>
            </div>
            <p className="hint scan-summary">
              共 {settings.scan.recordCount.toLocaleString()} 条记录
              {settings.scan.lastSyncTime ? ` · 更新于 ${new Date(settings.scan.lastSyncTime).toLocaleString()}` : ''}
            </p>
            <ul className="scan-list">
              {settings.scan.sources.map((source) => (
                <li key={source.id}>
                  <div>
                    <strong>{source.label}</strong>
                    <span>{source.exists ? `${source.filesScanned} 个文件 · ${source.records.toLocaleString()} 条` : '目录不存在'}</span>
                  </div>
                  <code>{source.path}</code>
                  {source.note && <p className="hint">{source.note}</p>}
                </li>
              ))}
              {settings.scan.sources.length === 0 && <li className="hint">尚未完成扫描</li>}
            </ul>
          </section>
        </div>
      ))}

      {open && message && <p className="settings-note" role="status">{message}</p>}
      {open && error && <aside className="notice" role="alert">{error}</aside>}
      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={(next) => onSaved(next)} />
    </section>
  );
};
