import React, { useEffect, useMemo, useState } from 'react';
import type { ClaudeLoginStatus, ConsoleSettings, PathSettings, QuotaState } from '../types';
import { calibrateData, deleteAccount, fetchClaudeStatus, refreshQuota, saveSettings } from '../api';
import { ACCOUNT_TYPE_LABEL } from '../lib/providers';
import { AddAccountDialog } from './AddAccountDialog';
import { Icon } from './Icon';

interface SettingsPageProps {
  open: boolean;
  onToggle: () => void;
  settings: ConsoleSettings | null;
  onSaved: (settings: ConsoleSettings, quota?: QuotaState | null) => void;
}

const PATH_FIELDS: Array<{ key: keyof PathSettings; label: string; hint: string }> = [
  { key: 'codexDir', label: 'Codex 目录', hint: '读取 sessions/ 会话用量，以及 auth.json 里的额度凭据。' },
  { key: 'piAgentDir', label: 'Pi Agent 目录', hint: '读取 sessions/ 会话和额度缓存。' },
  {
    key: 'claudeProjectsDir',
    label: 'Claude 对话目录',
    hint: '留空时自动扫描 ~/.claude/projects、~/.config/claude/projects 和 $CLAUDE_CONFIG_DIR。填写 ~/.claude 会自动使用其中的 projects。',
  },
  { key: 'grokSessionsDir', label: 'Grok 会话目录', hint: '读取 Grok Build 的 updates.jsonl。' },
];

const CLAUDE_STATE: Record<ClaudeLoginStatus['state'], { label: string; tone: string }> = {
  ok: { label: '已连接', tone: 'good' },
  not_logged_in: { label: '未登录', tone: 'muted' },
  expired: { label: '已过期', tone: 'danger' },
  no_subscription: { label: '无订阅额度', tone: 'warning' },
  error: { label: '读取失败', tone: 'danger' },
};

function samePaths(a: PathSettings, b: PathSettings): boolean {
  return PATH_FIELDS.every(({ key }) => a[key].trim() === b[key].trim());
}

const ClaudeLoginCard: React.FC<{ initial: ClaudeLoginStatus | null | undefined; onChecked: (quota: QuotaState) => void }> = ({ initial, onChecked }) => {
  const [status, setStatus] = useState<ClaudeLoginStatus | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) setStatus(initial);
  }, [initial]);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fetchClaudeStatus(true));
      onChecked(await refreshQuota());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const meta = status ? CLAUDE_STATE[status.state] : null;
  return (
    <section className="panel settings-card" aria-labelledby="claude-login-title">
      <div className="panel-head">
        <div>
          <h3 id="claude-login-title">本机 Claude Code 登录</h3>
          <p className="hint">自动读取本机凭据，过期时自动续期并写回原处</p>
        </div>
        <div className="row-wrap">
          {meta && <span className="badge" data-tone={meta.tone}>{meta.label}</span>}
          <button type="button" className="btn btn-sm" onClick={check} disabled={busy}>
            <Icon name="refresh" size={13} className={busy ? 'is-spinning' : undefined} />
            {busy ? '检测中' : '重新检测'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {!status && <p className="hint">尚未检测。点击「重新检测」。</p>}
        {status && (
          <>
            <div className="callout" data-tone={status.state === 'ok' ? 'good' : status.state === 'not_logged_in' ? 'info' : status.state === 'no_subscription' ? undefined : 'danger'}>
              <Icon name={status.state === 'ok' ? 'check' : status.state === 'not_logged_in' ? 'info' : 'alert'} size={15} />
              <span>{status.message}</span>
            </div>
            <dl className="kv">
              {status.email && <><dt>账户</dt><dd>{status.email}</dd></>}
              {status.organization && <><dt>组织</dt><dd>{status.organization}</dd></>}
              {status.plan && <><dt>套餐</dt><dd>{status.plan}</dd></>}
              {status.source && <><dt>凭据来源</dt><dd><code>{status.source}</code></dd></>}
              {status.expiresAt ? <><dt>令牌到期</dt><dd>{new Date(status.expiresAt).toLocaleString()}</dd></> : null}
              <dt>检测时间</dt><dd>{new Date(status.checkedAt).toLocaleString()}</dd>
            </dl>
          </>
        )}
        {error && <div className="callout" data-tone="danger" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}
      </div>
    </section>
  );
};

export const SettingsPage: React.FC<SettingsPageProps> = ({ open, onToggle, settings, onSaved }) => {
  const [draft, setDraft] = useState<PathSettings | null>(settings?.paths ?? null);
  const [savingPaths, setSavingPaths] = useState(false);
  const [savingHide, setSavingHide] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
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

  const savePaths = () => run(async () => {
    if (!draft) return;
    setSavingPaths(true);
    try {
      const result = await saveSettings({ paths: draft, dataDir, rescan: true });
      onSaved(result.settings, result.quota);
      setMessage('路径已保存，并重新扫描了本地用量');
    } finally {
      setSavingPaths(false);
    }
  });

  const calibrate = () => run(async () => {
    setCalibrating(true);
    try {
      const result = await calibrateData();
      onSaved(result.settings);
      setMessage(`已重新扫描，共 ${result.count.toLocaleString()} 条用量`);
    } finally {
      setCalibrating(false);
    }
  });

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
          <h2 id="settings-title">设置</h2>
        </button>
        {!open && <p className="hint">账户、本机登录检测、扫描路径</p>}
      </div>

      {open && (
        <>
          {message && <div className="callout" data-tone="good" role="status" style={{ marginBottom: 14 }}><Icon name="check" size={15} /><span>{message}</span></div>}
          {error && <div className="callout" data-tone="danger" role="alert" style={{ marginBottom: 14 }}><Icon name="alert" size={15} /><span>{error}</span></div>}
          {!settings || !draft ? (
            <div className="panel empty">正在读取设置…</div>
          ) : (
            <div id="settings-panel" className="settings-grid">
              <section className="panel settings-card" aria-labelledby="account-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="account-settings-title">账户</h3>
                    <p className="hint">只有已添加的账户会显示额度卡；本机登录会被自动识别并添加</p>
                  </div>
                  <div className="row-wrap">
                    <button type="button" className="btn btn-sm" onClick={calibrate} disabled={calibrating}>
                      {calibrating ? '扫描中…' : '重新扫描'}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
                      <Icon name="plus" size={13} />添加
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  <ul className="account-list">
                    {accounts.map((account) => (
                      <li key={account.id}>
                        <span className="chip">{ACCOUNT_TYPE_LABEL[account.type]}</span>
                        <div className="grow">
                          <strong>{account.label || account.email || ACCOUNT_TYPE_LABEL[account.type]}</strong>
                          <p className="hint" title={account.userId}>
                            {account.email && account.label ? `${account.email} · ` : ''}{account.userId || '未识别 ID'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-danger"
                          onClick={() => run(async () => onSaved((await deleteAccount(account.id)).settings))}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                    {accounts.length === 0 && <li className="hint">还没有账户。本机登录会在刷新时自动识别，也可以手动添加。</li>}
                  </ul>
                </div>
              </section>

              <ClaudeLoginCard initial={settings.claudeLogin} onChecked={(quota) => onSaved(settings, quota)} />

              <section className="panel settings-card span-2" aria-labelledby="path-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="path-settings-title">数据与扫描路径</h3>
                    <p className="hint">留空恢复默认，支持 ~ 开头</p>
                  </div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={savePaths} disabled={savingPaths || !dirty}>
                    {savingPaths ? '正在扫描…' : '保存并重新扫描'}
                  </button>
                </div>
                <div className="panel-body">
                  <label className="field">
                    <span className="field-label">数据目录</span>
                    <input className="input mono" value={dataDir} spellCheck={false} onChange={(event) => setDataDir(event.target.value)} />
                    <span className="hint">账户卡片和用量账本写在这里。只保存用户 ID 与用量，不保存 OAuth 令牌。</span>
                  </label>
                  {PATH_FIELDS.map((field) => {
                    const ready = settings.availability[field.key];
                    const effective = field.key === 'claudeProjectsDir' && settings.claudeProjectsAll?.length
                      ? settings.claudeProjectsAll.join('，')
                      : settings.resolved[field.key];
                    return (
                      <label key={field.key} className="field">
                        <span className="field-label">
                          {field.label}
                          <span className="ready" data-ready={ready ? 'true' : 'false'}>{ready ? '已找到' : '未找到'}</span>
                        </span>
                        <span className="path-control">
                          <input
                            className="input mono"
                            value={draft[field.key]}
                            spellCheck={false}
                            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                          />
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setDraft({ ...draft, [field.key]: settings.defaults[field.key] })}
                            disabled={draft[field.key] === settings.defaults[field.key]}
                          >
                            恢复默认
                          </button>
                        </span>
                        <span className="hint">{field.hint}</span>
                        {effective !== draft[field.key].trim() && <span className="hint">实际扫描：<code>{effective}</code></span>}
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="panel settings-card" aria-labelledby="display-settings-title">
                <div className="panel-head">
                  <h3 id="display-settings-title">显示</h3>
                </div>
                <div className="panel-body">
                  <div className="row">
                    <div>
                      <strong>隐藏 AGY 中的 Claude 额度</strong>
                      <p className="hint">只隐藏 Antigravity 额度卡里的 Claude 分组，不影响用量统计。</p>
                    </div>
                    <button
                      type="button"
                      className="switch"
                      role="switch"
                      aria-checked={hideAgyClaude}
                      aria-label="隐藏 AGY 中的 Claude 额度"
                      disabled={savingHide}
                      onClick={() => saveHide(!hideAgyClaude)}
                    />
                  </div>
                </div>
              </section>

              <section className="panel settings-card" aria-labelledby="scan-settings-title">
                <div className="panel-head">
                  <div>
                    <h3 id="scan-settings-title">最近扫描</h3>
                    <p className="hint">
                      共 {settings.scan.recordCount.toLocaleString()} 条
                      {settings.scan.lastSyncTime ? ` · ${new Date(settings.scan.lastSyncTime).toLocaleString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="panel-body">
                  <ul className="scan-list">
                    {settings.scan.sources.map((source) => (
                      <li key={source.id}>
                        <div className="row">
                          <strong>{source.label}</strong>
                          <span className="hint">{source.exists ? `${source.filesScanned} 个文件 · ${source.records.toLocaleString()} 条` : '目录不存在'}</span>
                        </div>
                        <code>{source.path}</code>
                        {source.note && <span className="hint">{source.note}</span>}
                      </li>
                    ))}
                    {settings.scan.sources.length === 0 && <li className="hint">尚未完成扫描</li>}
                  </ul>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={(next) => onSaved(next)} />
    </section>
  );
};
