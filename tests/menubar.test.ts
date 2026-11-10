import assert from 'node:assert/strict';
import http from 'node:http';
import test, { type TestContext } from 'node:test';
import {
  buildMenuBarModel,
  parseMenuBarArgs,
  readMenuBar,
  renderMenuBar,
  renderMenuBarOffline,
} from '../src/server/menubar.ts';
import type { ProviderQuota, QuotaState } from '../src/server/quota/types.ts';

const now = Date.UTC(2026, 10, 7, 3, 0);
const options = { url: 'http://127.0.0.1:3001', lang: 'en' as const, now, accounts: 'all' as const };

function account(id: string, type: 'gpt' | 'claude' | 'grok' | 'agy' = 'gpt', label = id, userId = id) {
  return { id, type, label, userId, ownLogin: true };
}

function quota(provider: string, remainingPercent: number, extra: Partial<ProviderQuota> = {}): ProviderQuota {
  return {
    provider,
    displayName: provider,
    status: 'ok',
    capturedAt: now,
    windows: [{ label: '5-Hour Limit', remainingPercent, windowMinutes: 300, resetAt: now + 3_600_000 }],
    ...extra,
  };
}

function state(providers: Record<string, ProviderQuota>): QuotaState {
  return { updatedAt: now, providers };
}

interface MenuPayload {
  image: string;
  label: string;
  accounts: { id: string; name: string }[];
  rows: { title: string; separator?: boolean; action?: 'dashboard' | 'refresh'; url?: string; accountId?: string }[];
}

function payload(output: string): MenuPayload { return JSON.parse(output) as MenuPayload; }
function menuText(output: string): string { return payload(output).rows.map(row => row.title).join('\n'); }
function image(output: string): string {
  const data = payload(output);
  assert.ok(data.image, 'menu must contain a template image');
  assert.equal(data.label, 'Usage Console');
  assert.doesNotMatch(menuText(output), /tooltip/, 'click menu has no hover metadata');
  return Buffer.from(data.image, 'base64').toString('utf8');
}

async function serve(t: TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test('menu-bar arguments select a local console, language, accounts, and entry mode', () => {
  const defaults = parseMenuBarArgs([]);
  assert.equal(defaults.url, 'http://127.0.0.1:3001');
  assert.equal(defaults.lang, 'zh');
  assert.equal(defaults.account, undefined);
  const parsed = parseMenuBarArgs([
    '--url', 'http://localhost:4010', '--lang', 'en', '--account', 'acc_work', '--data',
  ]);
  assert.equal(parsed.url, 'http://localhost:4010');
  assert.equal(parsed.lang, 'en');
  assert.equal(parsed.account, 'acc_work');
  assert.equal(parsed.data, true);
  assert.equal(parseMenuBarArgs(['--url', 'https://[::1]:4010']).url, 'https://[::1]:4010');
});

test('menu bar rejects remote, credential-bearing, non-root, and malformed options', () => {
  for (const url of [
    'https://example.com', 'http://127.0.0.1.evil.example:3001', 'http://0.0.0.0:3001',
    'http://user:password@127.0.0.1:3001', 'file:///tmp/quota', 'http://127.0.0.1:3001/api',
    'http://127.0.0.1:3001/?secret=x', 'http://127.0.0.1:3001/#fragment', 'not a URL',
  ]) assert.throws(() => parseMenuBarArgs(['--url', url]), url);
  for (const args of [['--url'], ['--lang'], ['--account'], ['--install'], ['--menubar'], ['--install-login'], ['--uninstall-login'], ['--lang', 'fr'], ['--unknown']]) {
    assert.throws(() => parseMenuBarArgs(args), args.join(' '));
  }
});

test('menu bar maps saved account order by provider key, including missing Codex account IDs', () => {
  const data = state({
    // Object insertion order intentionally differs from the saved account order.
    claude_shared: quota('claude', 64, { accountId: 'shared' }),
    codex_second: quota('codex', 33),
    codex_shared: quota('codex', 81, { plan: 'plus' }),
    codex_removed: quota('codex', 1),
  });
  const settings = { accounts: [
    { ...account('work', 'gpt', 'Work', 'shared'), email: 'work@example.com' },
    account('personal', 'claude', 'Personal', 'shared'), account('second', 'gpt', 'Second'),
  ] };
  const model = buildMenuBarModel(data, settings, options);
  assert.deepEqual(model.entries.map(entry => [entry.account.id, entry.minimum]), [['work', 81], ['personal', 64], ['second', 33]]);
  const output = renderMenuBar(data, settings, options);
  assert.doesNotMatch(menuText(output), /removed|Used|plus|work@example\.com|2026\//);
  assert.match(menuText(output), /5h · Remaining 81% · Reset 1h/);
  assert.deepEqual(payload(output).rows.filter(row => row.action).map(row => [row.action, row.url]), [['dashboard', 'http://127.0.0.1:3001/'], ['refresh', undefined]]);
  assert.ok(payload(output).rows.some(row => row.title === 'Refresh display' && row.action === 'refresh'));
  image(output);
});

test('menu bar keeps limiting windows and all accounts in the compact click menu', () => {
  const accounts = ['One', 'Two', 'Three', 'Four'].map((name) => account(name));
  const providers = Object.fromEntries(accounts.map((item) => [`codex_${item.userId}`, quota('codex', 72)]));
  providers.codex_One.windows!.push({ label: 'Weekly Limit', remainingPercent: 0, windowMinutes: 10_080 });
  const data = state(providers);
  const model = buildMenuBarModel(data, { accounts }, options);
  assert.equal(model.entries[0].minimum, 0);
  assert.equal(model.chosen.length, 4);
  const output = renderMenuBar(data, { accounts }, options);
  assert.match(image(output), /MediaBox \[0 0 82 16\]/);
  assert.match(menuText(output), /Four/);
  assert.match(menuText(output), /7d · Remaining 0%/);
  assert.doesNotMatch(menuText(output), /Weekly Limit|Used|Rings:|Menu bar:/);
});

test('menu bar can pin an account without hiding the other dropdown accounts', () => {
  const data = state({ codex_one: quota('codex', 10), claude_two: quota('claude', 80) });
  const settings = { accounts: [account('one', 'gpt', 'One'), account('two', 'claude', 'Two')] };
  const pinned = { ...options, accounts: undefined, account: 'two' };
  const model = buildMenuBarModel(data, settings, pinned);
  assert.deepEqual(model.chosen.map(entry => [entry.account.id, entry.minimum]), [['two', 80]]);
  const output = renderMenuBar(data, settings, pinned);
  assert.match(menuText(output), /One/);
  assert.match(menuText(output), /Two/);
  assert.match(image(output), /MediaBox \[0 0 16 16\]/);
});

test('one ring is the default and users can select a subset, all, or none', () => {
  const data = state({ codex_one: quota('codex', 80), claude_two: quota('claude', 35) });
  const settings = { accounts: [account('one', 'gpt', 'One'), account('two', 'claude', 'Two')] };
  const defaultOptions = { ...options, accounts: undefined };
  assert.deepEqual(buildMenuBarModel(data, settings, defaultOptions).chosen.map(entry => entry.account.id), ['one']);
  assert.match(image(renderMenuBar(data, settings, defaultOptions)), /MediaBox \[0 0 16 16\]/);
  const subsetOptions = { ...options, accounts: ['two'] };
  assert.deepEqual(buildMenuBarModel(data, settings, subsetOptions).chosen.map(entry => entry.account.id), ['two']);
  const subset = renderMenuBar(data, settings, subsetOptions);
  assert.deepEqual(payload(subset).accounts.map(account => account.id), ['one', 'two']);
  assert.match(image(renderMenuBar(data, settings, options)), /MediaBox \[0 0 38 16\]/);
  assert.equal(buildMenuBarModel(data, settings, options).chosen.length, 2);
  const noneOptions = { ...options, accounts: [] };
  assert.equal(buildMenuBarModel(data, settings, noneOptions).chosen.length, 0);
  const none = renderMenuBar(data, settings, noneOptions);
  assert.match(image(none), /MediaBox \[0 0 16 16\]/);
  assert.match(menuText(none), /One/);
  assert.match(menuText(none), /Two/);
  assert.deepEqual(parseMenuBarArgs(['--accounts', '["two"]']).accounts, ['two']);
  assert.equal(parseMenuBarArgs(['--accounts', 'all']).accounts, 'all');
  assert.throws(() => parseMenuBarArgs(['--accounts', '[1]']));
});

test('ring uses the lower 5h or 7d reading rather than an unrelated quota window', () => {
  const data = state({ codex_one: quota('codex', 80, { windows: [
    { label: 'Daily', remainingPercent: 1, windowMinutes: 1440 },
    { label: 'Primary quota', remainingPercent: 80, windowMinutes: 300 },
    { label: 'Secondary quota', remainingPercent: 20, windowMinutes: 10080 },
  ] }) });
  const settings = { accounts: [account('one')] };
  const entry = buildMenuBarModel(data, settings, options).entries[0];
  assert.equal(entry.minimum, 20);
  assert.deepEqual(entry.selectedWindows.map(win => win.windowMinutes), [300, 10080]);
  const output = renderMenuBar(data, settings, options);
  assert.match(menuText(output), /5h · Remaining 80%/);
  assert.match(menuText(output), /7d · Remaining 20%/);
  assert.match(menuText(output), /Daily · Remaining 1%/);
  assert.match(image(output), /^%PDF-1\.4/);
});

test('ring recognizes short period labels and keeps unknown target quota unknown', () => {
  const data = state({ codex_one: quota('codex', 80, { windows: [
    { label: '5h', remainingPercent: 65 }, { label: '7d', remainingPercent: 25 },
    { label: 'Daily', remainingPercent: 0 },
  ] }) });
  const settings = { accounts: [account('one')] };
  assert.equal(buildMenuBarModel(data, settings, options).entries[0].minimum, 25);
  const unknown = state({ codex_one: quota('codex', 80, { windows: [
    { label: '5h', remainingPercent: Number.NaN }, { label: 'Daily', remainingPercent: 90 },
  ] }) });
  assert.equal(buildMenuBarModel(unknown, settings, options).entries[0].minimum, null);
  assert.match(menuText(renderMenuBar(unknown, settings, options)), /5h · Remaining Unknown/);
});

test('menu bar honors hidden AGY Claude groups and only repeats group names when needed', () => {
  const agy = quota('antigravity', 0, {
    windows: undefined,
    groups: [
      { name: 'Claude models', windows: [{ label: 'Claude weekly', remainingPercent: 2 }] },
      { name: 'Gemini Pro', windows: [{ label: 'Gemini 5h', remainingPercent: 57, resetAt: now + 3_600_000 }] },
    ],
  });
  const settings = { accounts: [account('agy', 'agy', 'AGY', 'agy-local')], hideAgyClaude: true };
  const data = state({ antigravity: agy });
  const hidden = renderMenuBar(data, settings, options);
  assert.equal(buildMenuBarModel(data, settings, options).entries[0].minimum, 57);
  assert.doesNotMatch(menuText(hidden), /Gemini Pro|Claude weekly|Claude windows hidden/);
  const visibleSettings = { ...settings, hideAgyClaude: false };
  assert.equal(buildMenuBarModel(data, visibleSettings, options).entries[0].minimum, 2);
  assert.match(menuText(renderMenuBar(data, visibleSettings, options)), /Claude models/);
  agy.groups = [agy.groups![0]];
  assert.equal(buildMenuBarModel(data, settings, options).entries[0].windows.length, 1);
  assert.match(menuText(renderMenuBar(data, settings, options)), /7d · Remaining 2%/);
});

test('menu bar distinguishes stale readings, unavailable percentages, expired and missing logins', () => {
  const data = state({
    codex_stale: quota('codex', 37, { stale: true, status: 'warning', capturedAt: now - 120_000, errorCode: 'rate_limited' }),
    claude_expired: quota('claude', 0, { windows: undefined, status: 'error', errorCode: 'login_expired' }),
    grok_unsigned: quota('grok', 99),
    codex_unknown: quota('codex', Number.NaN),
  });
  const settings = { accounts: [
    account('stale', 'gpt', 'Stale'), account('expired', 'claude', 'Expired'),
    { ...account('unsigned', 'grok', 'Unsigned'), ownLogin: false }, account('unknown', 'gpt', 'Unknown'),
  ] };
  const model = buildMenuBarModel(data, settings, options);
  assert.equal(model.entries[0].quota.stale, true);
  assert.equal(model.entries[0].warning, true);
  assert.equal(model.entries[1].minimum, null);
  assert.equal(model.entries[2].minimum, null);
  assert.equal(model.entries[3].minimum, null);
  const output = renderMenuBar(data, settings, options);
  assert.match(menuText(output), /Login expired/);
  assert.match(menuText(output), /Login required/);
  assert.doesNotMatch(menuText(output), /NaN%|99%/);
});

test('menu bar clamps finite percentages and never infers a renewed quota after reset', () => {
  const data = state({ codex_one: quota('codex', 110, { windows: [
    { label: 'Future', remainingPercent: 110, resetAt: now + 60_000 },
    { label: 'Past', remainingPercent: -20, resetAt: now - 1 },
  ] }) });
  const settings = { accounts: [account('one')] };
  const entry = buildMenuBarModel(data, settings, options).entries[0];
  assert.equal(entry.minimum, 0);
  assert.equal(entry.warning, true);
  const output = renderMenuBar(data, settings, options);
  assert.match(menuText(output), /Remaining 100%/);
  assert.match(menuText(output), /Remaining 0%/);
  assert.match(menuText(output), /Waiting for update/);
  assert.doesNotMatch(menuText(output), /110%|-20%/);
});

test('structured menu data keeps untrusted text separate from executable actions', () => {
  const attack = '---\nInjected | action=dashboard url=http://127.0.0.1:3001/evil\r\n--Submenu\u001b[31m';
  const output = renderMenuBar(state({ codex_one: quota('codex', 50, {
    windows: [{ label: attack, remainingPercent: 50 }],
    status: 'warning', stale: true, errorMessage: attack,
  }) }), { accounts: [account('one', 'gpt', attack)] }, options);
  const data = payload(output);
  assert.doesNotMatch(menuText(output), /\r|\u001b|^Injected|^--Submenu/m);
  const actions = data.rows.filter(row => row.action);
  assert.deepEqual(actions.map(row => row.action), ['dashboard', 'refresh']);
  assert.equal(actions[0].url, 'http://127.0.0.1:3001/');
  assert.ok(data.rows.some(row => row.title.includes('action=dashboard') && row.action === undefined));
  assert.ok(data.accounts[0].id === 'one');
  image(output);
});

test('menu bar empty and offline outputs retain working dashboard and display refresh actions', () => {
  const empty = renderMenuBar(state({}), { accounts: [] }, options);
  assert.match(menuText(empty), /No accounts/);
  image(empty);
  const offline = renderMenuBarOffline(options);
  assert.match(menuText(offline), /Offline/);
  image(offline);
  for (const output of [empty, offline]) {
    assert.deepEqual(payload(output).rows.filter(row => row.action).map(row => [row.action, row.url]), [['dashboard', 'http://127.0.0.1:3001/'], ['refresh', undefined]]);
    assert.ok(payload(output).rows.some(row => row.title === 'Refresh display' && row.action === 'refresh'));
  }
});

test('menu bar reads only cached local GET endpoints and preserves settings-only failure data', async (t) => {
  const requests: string[] = [];
  let settingsFailure = false;
  const url = await serve(t, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/quota') res.end(JSON.stringify(state({ codex_one: quota('codex', 42) })));
    else if (req.url === '/api/settings' && !settingsFailure) res.end(JSON.stringify({ accounts: [account('one', 'gpt', 'Work')] }));
    else { res.statusCode = 500; res.end('{"error":"settings unavailable"}'); }
  });
  const output = await readMenuBar({ ...options, url });
  assert.match(menuText(output), /Work/);
  assert.match(menuText(output), /Remaining 42%/);
  assert.deepEqual(requests.sort(), ['GET /api/quota', 'GET /api/settings']);
  requests.length = 0;
  settingsFailure = true;
  const degraded = await readMenuBar({ ...options, url });
  assert.match(menuText(degraded), /42%/);
  assert.match(menuText(degraded), /[⚠!]|settings/i);
  assert.deepEqual(requests.sort(), ['GET /api/quota', 'GET /api/settings']);
});

test('menu bar reports malformed, failed, and timed-out quota reads as offline', async (t) => {
  let mode: 'bad-json' | 'error' | 'http-error' | 'timeout' = 'bad-json';
  const url = await serve(t, (req, res) => {
    if (req.url === '/api/settings') { res.end(JSON.stringify({ accounts: [account('one')] })); return; }
    if (mode === 'timeout') return;
    if (mode === 'http-error') res.statusCode = 500;
    res.end(mode === 'bad-json' ? '<html>not JSON</html>' : JSON.stringify({ providers: {}, error: 'read failed' }));
  });
  for (const next of ['bad-json', 'error', 'http-error', 'timeout'] as const) {
    mode = next;
    const output = await readMenuBar({ ...options, url }, 100);
    assert.match(menuText(output), /Offline/, mode);
    assert.match(menuText(output), /Open dashboard/, mode);
  }
});

