import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserUrl, isLoopbackHost, resolveListenHost, resolveListenPort } from './listen.js';
import { quotaRingImage } from './menubar-rings.js';
import type { ProviderQuota, QuotaState, QuotaWindow } from './quota/types.js';

interface Options {
  url: string;
  lang: 'zh' | 'en';
  account?: string;
  accounts?: string[] | 'all';
  now?: number;
}

interface Account {
  id: string;
  type: 'gpt' | 'claude' | 'grok' | 'agy';
  label: string;
  userId?: string;
  email?: string;
  ownLogin?: boolean;
}

interface Settings {
  accounts: Account[];
  hideAgyClaude?: boolean;
}

interface MenuRow {
  title: string;
  separator?: boolean;
  action?: 'dashboard' | 'refresh';
  url?: string;
  accountId?: string;
}

interface MenuPayload {
  image: string;
  label: string;
  accounts: Array<{ id: string; name: string }>;
  rows: MenuRow[];
}

const NAMES = { gpt: 'Codex', claude: 'Claude', grok: 'Grok', agy: 'AGY' };
const PREFIXES = { gpt: 'codex_', claude: 'claude_', grok: 'grok_', agy: 'antigravity' };
const TEXT = {
  zh: {
    remaining: '剩余', reset: '重置', waiting: '等待更新', unknown: '未知',
    login_required: '需要登录', login_expired: '登录已失效', loading: '正在读取',
    no_subscription: '没有可用订阅', rate_limited: '查询限流', read_failed: '读取失败',
    agy_unavailable: 'AGY 不可用', stale: '上次成功读数', ago: '前', noAccounts: '尚未添加账户',
    offline: '服务离线或读取失败', open: '打开完整看板', refresh: '刷新显示',
    settingsFailed: '账户设置读取失败，暂用接口名称', missingAccount: '所选账户不存在',
    start: '请检查本地服务或重新运行 usage-console menubar', noWindows: '暂无额度窗口',
    noneSelected: '未选择显示账户，请点击圆环选择',
  },
  en: {
    remaining: 'Remaining', reset: 'Reset', waiting: 'Waiting for update', unknown: 'Unknown',
    login_required: 'Login required', login_expired: 'Login expired', loading: 'Loading',
    no_subscription: 'No subscription', rate_limited: 'Rate limited', read_failed: 'Read failed',
    agy_unavailable: 'AGY unavailable', stale: 'Last good reading', ago: 'ago', noAccounts: 'No accounts',
    offline: 'Offline or read failed', open: 'Open dashboard', refresh: 'Refresh display',
    settingsFailed: 'Account settings unavailable; using API names', missingAccount: 'Selected account not found',
    start: 'Check the local service or rerun usage-console menubar', noWindows: 'No quota windows',
    noneSelected: 'No visible accounts selected; click the ring to choose',
  },
};

/** Keep untrusted account and provider text on one line; actions are separate typed fields. */
function safeText(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function localUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopbackHost(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('--url must be a loopback http(s) origin, e.g. http://127.0.0.1:3001');
  }
  return url.origin;
}

type MenuBarOptions = Options & { data?: boolean; attach?: boolean };

export function parseMenuBarArgs(argv: string[]): MenuBarOptions {
  const options: MenuBarOptions = { url: 'http://127.0.0.1:3001', lang: 'zh' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data') { options.data = true; continue; }
    const [flag] = argv[index].split('=');
    if (!['--url', '--lang', '--account', '--accounts'].includes(flag)) throw new Error(`Unknown menu bar argument: ${flag}`);
    const equals = argv[index].indexOf('=');
    const value = equals >= 0 ? argv[index].slice(equals + 1) : argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--url') {
      options.url = localUrl(value);
      options.attach = true;
    }
    if (flag === '--lang') {
      if (value !== 'zh' && value !== 'en') throw new Error('--lang must be zh or en');
      options.lang = value;
    }
    if (flag === '--account') options.account = value;
    if (flag === '--accounts') {
      const ids: unknown = value === 'all' ? 'all' : JSON.parse(value);
      if (ids !== 'all' && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string'))) throw new Error('--accounts must be all or a JSON array of account IDs');
      options.accounts = ids as string[] | 'all';
    }
  }
  return options;
}

function percent(value: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function periodMinutes(win: QuotaWindow): number | undefined {
  if (win.windowMinutes && Number.isFinite(win.windowMinutes)) return win.windowMinutes;
  if (/5\s*-?\s*(?:hour|小时|h\b)|five\s*hour|^primary$/i.test(win.label)) return 300;
  if (/week|每周|7\s*(?:d\b|days?|天)|^secondary$/i.test(win.label)) return 10080;
  return undefined;
}

function duration(ms: number, lang: Options['lang']): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const mins = minutes % 60;
  return [days && `${days}${lang === 'zh' ? '天' : 'd'}`, hours && `${hours}${lang === 'zh' ? '时' : 'h'}`,
    !days && mins && `${mins}${lang === 'zh' ? '分' : 'm'}`].filter(Boolean).join(lang === 'zh' ? '' : ' ');
}

function windowsFor(quota: ProviderQuota, hideClaude: boolean): { windows: Array<QuotaWindow & { group?: string }>; hidden: boolean } {
  const groups = quota.groups ?? [];
  const hidden = !quota.windows?.length && hideClaude && groups.some(group => !/claude/i.test(group.name))
    && groups.some(group => /claude/i.test(group.name));
  const windows = quota.windows?.length ? quota.windows : groups
    .filter(group => !(hidden && /claude/i.test(group.name)))
    .flatMap(group => group.windows.map(win => ({ ...win, group: group.name })));
  const rank = (win: QuotaWindow) => win.windowMinutes || (/5\s*-?\s*hour|five\s*hour|5\s*小时|^primary$/i.test(win.label)
    ? 300 : /week|每周|^secondary$/i.test(win.label) ? 10080 : Number.MAX_SAFE_INTEGER);
  return { windows: [...windows].sort((a, b) => rank(a) - rank(b)), hidden };
}

function actions(options: Options): MenuRow[] {
  const text = TEXT[options.lang];
  return [{ title: '', separator: true }, { title: text.open, action: 'dashboard', url: `${localUrl(options.url)}/` }, { title: text.refresh, action: 'refresh' }];
}

export function renderMenuBarOffline(options: Options): string {
  const text = TEXT[options.lang];
  const payload: MenuPayload = {
    image: quotaRingImage([{ remaining: null, warning: true }]), label: 'Usage Console', accounts: [],
    rows: [{ title: text.offline }, { title: text.start }, ...actions(options)],
  };
  return JSON.stringify(payload);
}

export function buildMenuBarModel(state: QuotaState, settings: Settings, options: Options) {
  const now = options.now ?? Date.now();
  const names = settings.accounts.map(account => `${NAMES[account.type]}${account.label && account.label !== NAMES[account.type] ? ` [${account.label}]` : ''}`);
  const entries = settings.accounts.map((account, index) => {
    const key = account.type === 'agy' ? 'antigravity' : `${PREFIXES[account.type]}${account.userId}`;
    let quota = state.providers[key];
    if (account.type !== 'agy' && !account.ownLogin) {
      quota = { provider: account.type, displayName: account.label, status: 'unconfigured', capturedAt: 0, errorCode: 'login_required' };
    } else if (!quota || quota.errorCode === 'login_required') {
      quota = { provider: account.type, displayName: account.label, status: 'loading', capturedAt: 0 };
    }
    const blocked = quota.errorCode === 'login_required' || quota.errorCode === 'login_expired'
      || quota.status === 'error' || quota.status === 'unconfigured' || quota.status === 'loading';
    const { windows, hidden } = blocked ? { windows: [], hidden: false } : windowsFor(quota, account.type === 'agy' && settings.hideAgyClaude !== false);
    const targetWindows = windows.filter(win => [300, 10080].includes(periodMinutes(win) ?? 0));
    const selectedWindows = targetWindows.length ? targetWindows : windows;
    const known = selectedWindows.map(win => percent(win.remainingPercent)).filter((value): value is number => value !== null);
    const minimum = known.length ? Math.min(...known) : null;
    const base = names[index];
    const duplicate = names.filter(name => name === base).length > 1;
    let identifier = account.email?.split('@')[0] || `#${index + 1}`;
    if (account.email && settings.accounts.some((other, otherIndex) => otherIndex !== index && names[otherIndex] === base && other.email?.split('@')[0] === identifier)) identifier = account.email;
    const name = duplicate ? `${base} · ${identifier}` : base;
    const overdue = windows.some(win => Number.isFinite(win.resetAt) && win.resetAt! > 0 && win.resetAt! <= now);
    return { account, quota, windows, selectedWindows, hidden, minimum, name, warning: Boolean(blocked || quota.stale || quota.status === 'warning' || overdue) };
  });
  const chosen = options.accounts === 'all' ? entries : Array.isArray(options.accounts)
    ? entries.filter(entry => options.accounts!.includes(entry.account.id))
    : options.account ? entries.filter(entry => entry.account.id === options.account) : entries.slice(0, 1);
  return { entries, chosen };
}

export function renderMenuBar(state: QuotaState & { error?: string }, settings: Settings, options: Options): string {
  if (state.error) return renderMenuBarOffline(options);
  const text = TEXT[options.lang];
  const now = options.now ?? Date.now();
  const { entries, chosen } = buildMenuBarModel(state, settings, options);
  const rows: MenuRow[] = [];
  if (!entries.length) rows.push({ title: text.noAccounts });
  if (options.account && !chosen.length) rows.push({ title: text.missingAccount });
  for (const { account, quota, windows, name } of entries) {
    if (rows.length) rows.push({ title: '', separator: true });
    rows.push({ title: safeText(name), accountId: account.id });
    const notices: string[] = [];
    if (quota.stale) {
      const age = quota.capturedAt > 0 ? `${duration(Math.max(0, now - quota.capturedAt), options.lang)} ${text.ago}` : text.unknown;
      notices.push(`${text.stale}: ${age}`);
    }
    if (quota.errorCode) notices.push(text[quota.errorCode]);
    else if (quota.status === 'loading') notices.push(text.loading);
    else if (quota.status === 'error' || quota.status === 'warning') notices.push(text.read_failed);
    if (notices.length) rows.push({ title: safeText(`⚠ ${notices.join(' · ')}`) });
    if (!windows.length && quota.status === 'ok') rows.push({ title: text.noWindows });
    const multipleGroups = new Set(windows.map(win => win.group).filter(Boolean)).size > 1;
    for (const win of windows) {
      const remaining = percent(win.remainingPercent);
      const period = periodMinutes(win);
      const label = [multipleGroups ? win.group : undefined, period === 300 ? '5h' : period === 10080 ? '7d' : win.label].filter(Boolean).join(' · ');
      const resetAt = win.resetAt;
      const valid = resetAt && Number.isFinite(resetAt) && Number.isFinite(new Date(resetAt).getTime());
      const reset = valid ? resetAt <= now ? text.waiting : duration(resetAt - now, options.lang) : text.unknown;
      rows.push({ title: safeText(`${label} · ${text.remaining} ${remaining === null ? text.unknown : `${Math.round(remaining)}%`} · ${text.reset} ${reset}`) });
    }
  }
  rows.push(...actions(options));
  const payload: MenuPayload = {
    image: quotaRingImage(chosen.map(entry => ({ remaining: entry.minimum, warning: entry.warning }))),
    label: 'Usage Console', accounts: entries.map(entry => ({ id: entry.account.id, name: safeText(entry.name) })), rows,
  };
  return JSON.stringify(payload);
}

/** Use core HTTP directly: localhost reads must bypass any environment proxy. No redirects. */
export function readJson(url: URL, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const agent = new transport.Agent();
    const request = transport.get(url, { agent, headers: { 'Accept-Language': 'en', Accept: 'application/json' } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('API request failed'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) request.destroy(new Error('API response too large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('API timeout')), timeoutMs);
    request.on('close', () => { clearTimeout(timer); agent.destroy(); });
    request.on('error', reject);
  });
}

export async function readMenuBar(options: Options, timeoutMs = 8000): Promise<string> {
  const origin = localUrl(options.url);
  const [quota, settings] = await Promise.allSettled([
    readJson(new URL('/api/quota', origin), timeoutMs), readJson(new URL('/api/settings', origin), timeoutMs),
  ]);
  if (quota.status !== 'fulfilled') return renderMenuBarOffline(options);
  try {
    const state = quota.value as QuotaState & { error?: string };
    if (!state || !state.providers || typeof state.providers !== 'object' || Array.isArray(state.providers)) return renderMenuBarOffline(options);
    if (state.error) return renderMenuBarOffline(options);
    if (settings.status === 'fulfilled' && Array.isArray((settings.value as Settings)?.accounts)) {
      return renderMenuBar(state, settings.value as Settings, options);
    }
    // Keep quota visible if only the account-settings endpoint fails; never guess an account association.
    const accounts: Account[] = Object.entries(state.providers).map(([key, value]) => {
      const type = key.startsWith('codex_') ? 'gpt' : key.startsWith('claude_') ? 'claude' : key.startsWith('grok_') ? 'grok' : 'agy';
      return { id: key, type, label: value.displayName, userId: key.slice(PREFIXES[type].length), ownLogin: true };
    });
    const payload = JSON.parse(renderMenuBar(state, { accounts, hideAgyClaude: false }, options)) as MenuPayload;
    payload.rows.unshift({ title: `⚠ ${TEXT[options.lang].settingsFailed}` });
    return JSON.stringify(payload);
  } catch {
    return renderMenuBarOffline(options);
  }
}

function menuBarExecutable(cache: string): string {
  const bundled = fileURLToPath(new URL('../native/UsageConsoleMenuBar', import.meta.url));
  // Darwin 22 is macOS 13, the deployment target of the Intel slice.
  const supportsBundledHelper = process.arch === 'arm64'
    || (process.arch === 'x64' && Number.parseInt(os.release(), 10) >= 22);
  if (supportsBundledHelper && fs.existsSync(bundled)) return bundled;

  const source = fileURLToPath(new URL('../../bin/UsageConsoleMenuBar.swift', import.meta.url));
  const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 16);
  const executable = path.join(cache, `UsageConsoleMenuBar-${hash}`);
  if (!fs.existsSync(executable)) {
    const temporary = `${executable}.${process.pid}.tmp`;
    try {
      execFileSync('/usr/bin/xcrun', ['swiftc', source, '-O', '-module-cache-path', path.join(cache, 'modules'), '-o', temporary], { timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
      fs.renameSync(temporary, executable);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`Could not build the menu bar helper. Install Apple's Command Line Tools (xcode-select --install).\n${String((error as { stderr?: Buffer }).stderr ?? error)}`);
    }
  }
  return executable;
}

async function launchMenuBar(options: MenuBarOptions): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The native menu bar requires macOS. Run usage-console to open the web dashboard.');
  }
  const url = options.attach ? options.url : localUrl(browserUrl(resolveListenHost(), resolveListenPort()));
  const cache = path.join(os.homedir(), '.usage-console', 'menubar');
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const executable = menuBarExecutable(cache);
  const worker = options.attach ? '' : fileURLToPath(new URL('./menubar-service.js', import.meta.url));
  const args = [cache, worker, process.execPath, fileURLToPath(new URL('../../bin/usage-console.js', import.meta.url)), 'menubar', '--data', '--url', url, '--lang', options.lang];
  if (options.account) args.push('--account', options.account);
  if (options.accounts) args.push('--accounts', options.accounts === 'all' ? 'all' : JSON.stringify(options.accounts));
  const child = spawn(executable, args, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Timed out starting the macOS menu bar.')), 15_000);
      const stop = () => {
        clearTimeout(timer);
        process.removeListener('SIGINT', interrupted);
        process.removeListener('SIGTERM', interrupted);
      };
      const interrupted = () => reject(new Error('Menu bar startup interrupted.'));
      process.once('SIGINT', interrupted);
      process.once('SIGTERM', interrupted);
      child.once('error', reject);
      child.once('close', (code, signal) => reject(new Error(`Menu bar exited during startup (${signal ?? code}).`)));
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        output += chunk;
        const newline = output.indexOf('\n');
        if (newline < 0 && output.length < 4096) return;
        const line = output.slice(0, newline < 0 ? 4096 : newline);
        if (line === 'ready' || line === 'already running') resolve();
        else reject(new Error(line || 'Menu bar startup failed.'));
      });
      child.stdout.once('close', stop);
    });
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    child.stdout.destroy();
    child.unref();
  }
}

export async function menuBarMain(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: usage-console menubar [--url http://127.0.0.1:3001] [--lang zh|en] [--account <account-id>] [--accounts all]

Starts the macOS menu bar and its local service (or uses a running service).
The npm release includes a precompiled helper for Apple Silicon and Intel on macOS 13+.
A source checkout or an older Intel Mac needs macOS Command Line Tools.
--url attaches to an existing loopback service. CONSOLE_PORT selects the automatic startup port.
--data prints structured menu JSON instead of starting the native helper.
--account / --accounts select initial rings. Saved menu selections take precedence.`);
    return;
  }
  const options = parseMenuBarArgs(argv);
  if (options.data) process.stdout.write(await readMenuBar(options));
  else await launchMenuBar(options);
}
