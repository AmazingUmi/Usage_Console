import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';
import type { CustomUsageSource, GroupedUsage, ScanSourceStatus, TokenUsageRecord, UsageScanProgress } from '../src/server/usage/types.ts';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'src/server/cli.ts');
const menuService = path.join(root, 'src/server/menubar-service.ts');

function isolatedEnv(home: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:https?_proxy|all_proxy|no_proxy|console_.*|node_options|node_use_env_proxy|claude_config_dir|agy_binary)$/i.test(key)) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    CONSOLE_SETTINGS_PATH: path.join(home, 'settings.json'),
    CLAUDE_CONFIG_DIR: '',
    ...overrides,
  };
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as net.AddressInfo).port;
}

async function startCli(t: TestContext, home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-server-test-')), keepHome = false): Promise<string> {
  const reservation = net.createServer();
  const port = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', cli, '--no-open', '--port', String(port)], {
    cwd: root, env: isolatedEnv(home), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  t.after(async () => {
    child.kill();
    await closed;
    if (!keepHome) fs.rmSync(home, { recursive: true, force: true });
  });
  let output = '';
  let timer: NodeJS.Timeout;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`CLI did not start: ${output}`)), 10_000);
      child.once('error', reject);
      child.once('close', (code) => reject(new Error(`CLI exited (${code}): ${output}`)));
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Usage Console\s+(http:\/\/[^\s]+)/);
        if (match) resolve(match[1]);
      });
    });
  } finally {
    clearTimeout(timer!);
  }
}

async function request(base: string, headers: http.OutgoingHttpHeaders = {}, method = 'POST', route = '/api/login/claude/start', body?: Record<string, unknown>) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } : headers;
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(new URL(route, base), { method, headers: requestHeaders }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.end(payload);
  });
}

test('quota reads stay idle and the usage scan stream reports completed sources', { timeout: 10_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-on-demand-test-'));
  const sessions = path.join(home, '.pi', 'agent', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(sessions, 'one.jsonl'), JSON.stringify({
    type: 'message',
    timestamp,
    message: { model: 'gpt-5.4', usage: { input: 10, output: 5 } },
  }));
  const url = await startCli(t, home);
  const ledger = path.join(home, '.usage-console', 'usage.jsonl');
  assert.equal((await request(url, {}, 'GET', '/api/menubar?lang=en')).status, 200);
  assert.equal((await request(url, {}, 'GET', '/api/quota')).status, 200);
  assert.equal(fs.existsSync(ledger), false);

  const events = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get(`${url}/api/usage/progress`, resolve).once('error', reject);
  });
  t.after(() => { events.destroy(); });
  assert.match(events.headers['content-type'] ?? '', /text\/event-stream/);
  const lines = createInterface({ input: events })[Symbol.asyncIterator]();
  async function nextProgress(): Promise<UsageScanProgress> {
    for (;;) {
      const line = await lines.next();
      assert.equal(line.done, false, 'Progress stream closed early');
      if (line.value.startsWith('data: ')) return JSON.parse(line.value.slice(6));
    }
  }
  assert.deepEqual(await nextProgress(), { running: false, completedSources: 0, totalSources: 0, lastSyncTime: 0 });

  const summary = request(url, {}, 'GET', '/api/usage/summary?range=all');
  const completed = [];
  let progress = await nextProgress();
  while (progress.running) {
    assert.equal(progress.totalSources, 5);
    completed.push(progress.completedSources);
    progress = await nextProgress();
  }
  assert.deepEqual(completed, [0, 1, 2, 3, 4, 5]);
  assert.ok(progress.lastSyncTime > 0);
  events.destroy();

  const result = await summary;
  assert.equal(result.status, 200);
  const data = JSON.parse(result.body);
  assert.equal(data.summary.requestCount, 1);
  assert.equal(data.summary.totalTokens, 15);
  assert.equal(fs.existsSync(ledger), true);
});

function writeUsageLog(file: string, ...rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('custom scan sources select a parser and group by harness without double counting overlaps', { timeout: 10_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-custom-sources-'));
  const timestamp = new Date().toISOString();
  const piSessions = path.join(home, '.pi', 'agent', 'sessions');
  const customPi = path.join(piSessions, 'experiments');
  const customCodex = path.join(home, 'codex-archive');
  const customClaude = path.join(home, 'claude-archive');
  const customAgy = path.join(home, 'agy-archive');
  writeUsageLog(path.join(piSessions, 'default.jsonl'), {
    type: 'message', timestamp, message: { model: 'gpt-5.4', usage: { input: 10, output: 2 } },
  });
  writeUsageLog(path.join(customPi, 'run.jsonl'), null, {
    type: 'message', timestamp, message: { model: {}, usage: { input: 999, output: 999 } },
  }, {
    type: 'message', timestamp, message: { model: 'gpt-5.4', usage: { input: 10, output: 5, cacheRead: 3 } },
  });
  writeUsageLog(path.join(customCodex, 'rollout.jsonl'), null, {
    type: 'turn_context', timestamp, payload: { model: 'gpt-5.4' },
  }, {
    type: 'event_msg', timestamp,
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 23, output_tokens: 6 } } },
  });
  const claudeMessage = { id: 'msg-1', model: 'claude-sonnet-4', usage: { input_tokens: 30, output_tokens: 2 } };
  writeUsageLog(path.join(home, '.claude', 'projects', 'workspace', 'session.jsonl'), {
    type: 'assistant', timestamp, message: claudeMessage,
  });
  writeUsageLog(path.join(customClaude, 'session.jsonl'), null, {
    type: 'assistant', timestamp,
    message: { ...claudeMessage, stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 20 } },
  });
  writeUsageLog(path.join(customAgy, 'conversation', '.system_generated', 'logs', 'transcript.jsonl'), null, {
    type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', step_index: 1,
    created_at: timestamp, input_tokens: 7, output_tokens: 3,
  });

  const url = await startCli(t, home);
  const sources = [
    { harnessName: '实验记录', directory: customPi, format: 'pi' },
    { harnessName: '实验记录', directory: '~/codex-archive', format: 'codex' },
    { harnessName: '实验记录', directory: customClaude, format: 'claude' },
    { harnessName: 'AGY archive', directory: customAgy, format: 'antigravity' },
    { harnessName: 'Wrong format', directory: customCodex, format: 'pi' },
  ];
  const saved = await request(url, {}, 'PUT', '/api/settings', { customUsageSources: sources });
  assert.equal(saved.status, 200, saved.body);
  const settings = JSON.parse(saved.body).settings as {
    customUsageSources: CustomUsageSource[];
    scan: { sources: ScanSourceStatus[]; recordCount: number };
  };
  assert.equal(settings.customUsageSources[1].directory, customCodex);
  assert.equal(settings.scan.recordCount, 5);
  const reports = new Map(settings.scan.sources.map((report) => [report.id, report]));
  assert.equal(reports.get('pi-session')?.filesScanned, 1);
  assert.equal(reports.get('claude')?.records, 0);
  const customReports = settings.customUsageSources.map(({ id }) => reports.get(`custom:${id}`));
  assert.deepEqual(customReports.map((report) => report?.filesScanned), [1, 1, 1, 1, 1]);
  assert.deepEqual(customReports.map((report) => report?.records), [1, 1, 1, 1, 0]);
  assert.deepEqual(customReports[4]?.noteCodes, ['no-usage']);

  const clients = await request(url, {}, 'GET', '/api/usage/by-client?range=all');
  assert.equal(clients.status, 200);
  const groups: GroupedUsage[] = JSON.parse(clients.body).data;
  assert.deepEqual(groups.map(({ name, totalTokens, requestCount }) => [name, totalTokens, requestCount]), [
    ['实验记录', 94, 3], ['pi', 12, 1], ['AGY archive', 10, 1],
  ]);
  const result = await request(url, {}, 'GET', '/api/usage/records?range=all');
  const records: TokenUsageRecord[] = JSON.parse(result.body).records;
  assert.equal(records.find((record) => record.client === 'codex')?.harnessName, '实验记录');
  assert.equal(records.find((record) => record.client === 'codex')?.provider, 'openai-codex');
  assert.equal(records.find((record) => record.client === 'pi' && record.harnessName)?.cacheRead, 3);

  const unsupported = await request(url, { 'x-lang': 'en' }, 'PUT', '/api/settings', {
    customUsageSources: [{ ...sources[0], format: 'unknown' }],
  });
  assert.equal(unsupported.status, 400);
  assert.match(unsupported.body, /Choose a supported session format/);
  const persisted = await request(url, {}, 'GET', '/api/settings');
  assert.deepEqual(JSON.parse(persisted.body).customUsageSources, settings.customUsageSources);

  // Refresh a modified rollout, retain history for a removed file and relabel an unchanged Pi log.
  fs.unlinkSync(path.join(piSessions, 'default.jsonl'));
  fs.appendFileSync(path.join(customCodex, 'rollout.jsonl'), `${JSON.stringify({
    type: 'event_msg', timestamp,
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 6, output_tokens: 3 } } },
  })}\n`);
  const rescanned = await request(url, {}, 'PUT', '/api/settings', {
    customUsageSources: [{ ...sources[0], harnessName: 'Pi bench' }, ...sources.slice(1)],
  });
  assert.equal(rescanned.status, 200, rescanned.body);
  const overview = await request(url, {}, 'GET', '/api/usage/overview?range=all');
  assert.equal(overview.status, 200);
  const updated = JSON.parse(overview.body);
  assert.deepEqual(updated.scan, JSON.parse(rescanned.body).settings.scan);
  assert.deepEqual((updated.clients as GroupedUsage[]).map(({ name, totalTokens, requestCount }) => [name, totalTokens, requestCount]), [
    ['实验记录', 88, 3], ['Pi bench', 15, 1], ['pi', 12, 1], ['AGY archive', 10, 1],
  ]);
});

test('usage history survives removed files, removed sources and a service restart', { timeout: 10_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-custom-cache-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, 'grok-archive');
  const file = path.join(directory, 'session', 'updates.jsonl');
  const ledger = path.join(home, '.usage-console', 'usage.jsonl');
  const legacyTimestamp = Date.now() - 60_000;
  writeUsageLog(ledger, {
    id: `codex_${legacyTimestamp}_12_gpt-5.4`, timestamp: legacyTimestamp,
    client: 'codex', provider: 'openai-codex', model: 'gpt-5.4', input: 8, output: 4,
  });
  writeUsageLog(file, {
    timestamp: new Date().toISOString(),
    params: { update: { sessionUpdate: 'turn_completed', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 25 } } },
  });
  const source = { harnessName: 'Grok archive', directory, format: 'grok' };
  await t.test('collect usage, rename the unavailable source and remove it', async (stage) => {
    const url = await startCli(stage, home, true);
    const saved = await request(url, {}, 'PUT', '/api/settings', { customUsageSources: [source] });
    assert.equal(saved.status, 200, saved.body);
    assert.equal(JSON.parse(saved.body).settings.scan.recordCount, 2);
    fs.unlinkSync(file);

    const renamed = await request(url, {}, 'PUT', '/api/settings', {
      customUsageSources: [{ ...source, harnessName: 'Archived build' }],
    });
    assert.equal(renamed.status, 200, renamed.body);
    const removed = await request(url, {}, 'PUT', '/api/settings', { customUsageSources: [] });
    assert.equal(removed.status, 200, removed.body);
    assert.equal(JSON.parse(removed.body).settings.scan.recordCount, 2);
    assert.equal(JSON.parse(removed.body).settings.scan.sources.length, 5);
  });

  // Simulate an interrupted write and a new session discovered after restarting.
  fs.appendFileSync(ledger, '{"id":"interrupted');
  const piFile = path.join(home, '.pi', 'agent', 'sessions', 'new.jsonl');
  writeUsageLog(piFile, {
    type: 'message', timestamp: new Date().toISOString(),
    message: { model: 'gpt-5.4', usage: { input: 10, output: 5 } },
  });
  await t.test('merge a new session with the persisted history', async (stage) => {
    const url = await startCli(stage, home, true);
    const listed = await request(url, {}, 'GET', '/api/usage/by-client?range=all');
    assert.equal(listed.status, 200, listed.body);
    const groups: GroupedUsage[] = JSON.parse(listed.body).data;
    assert.deepEqual(groups.map(({ name, totalTokens }) => [name, totalTokens]), [['Archived build', 25], ['pi', 15], ['codex', 12]]);

    const size = fs.statSync(ledger).size;
    const repeated = await request(url, {}, 'POST', '/api/usage/sync');
    assert.equal(repeated.status, 200, repeated.body);
    assert.equal(JSON.parse(repeated.body).count, 3);
    assert.equal(fs.statSync(ledger).size, size);
  });

  fs.unlinkSync(piFile);
  await t.test('read all archived sessions from the ledger alone', async (stage) => {
    const url = await startCli(stage, home, true);
    const result = await request(url, {}, 'GET', '/api/usage/summary?range=all');
    assert.equal(result.status, 200, result.body);
    assert.equal(JSON.parse(result.body).summary.totalTokens, 52);
    assert.equal(JSON.parse(result.body).summary.requestCount, 3);
  });
});

test('menu bar starts a local service, reads menu data, and shuts it down when the owner closes', { timeout: 15_000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-menu-owner-test-'));
  const reservation = net.createServer();
  const port = await listen(reservation);
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', menuService, url], {
    cwd: root, env: isolatedEnv(home), stdio: ['pipe', 'pipe', 'ignore'],
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  t.after(async () => {
    child.kill();
    await closed;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const lines = createInterface({ input: child.stdout });
  const ready = await lines[Symbol.asyncIterator]().next();
  lines.close();
  assert.equal(ready.value, 'owned');
  const health = await request(url, {}, 'GET', '/api/health');
  assert.equal(JSON.parse(health.body).app, 'usage-console');
  const menu = await request(url, {}, 'GET', '/api/menubar?lang=en&accounts=all');
  assert.equal(menu.status, 200);
  const payload = JSON.parse(menu.body);
  assert.ok(payload.rows.some((row: { title: string }) => row.title === 'No accounts'));
  assert.ok(Buffer.from(payload.image, 'base64').toString().startsWith('%PDF-1.4'));
  assert.equal((await request(url, {}, 'GET', '/api/menubar?lang=en&accounts=invalid')).status, 400);
  assert.equal((await request(url, { 'Sec-Fetch-Site': 'cross-site' }, 'GET', '/api/menubar')).status, 403);
  child.stdin.end();
  assert.equal(await closed, 0);
  await assert.rejects(request(url, {}, 'GET', '/api/health'), { code: 'ECONNREFUSED' });
});

test('menu bar reuses a running web console and leaves it running', { timeout: 15_000 }, async (t) => {
  const url = await startCli(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-menu-reuse-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const result = await execFileAsync(process.execPath, ['--import', 'tsx', menuService, url], {
    cwd: root, env: isolatedEnv(home), timeout: 5000,
  });
  assert.equal(result.stdout.trim(), 'reused');
  assert.equal((await request(url, {}, 'GET', '/api/health')).status, 200);
  assert.equal(fs.existsSync(path.join(home, '.usage-console')), false);
});

test('menu bar leaves an unrelated listener alone', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-menu-conflict-test-'));
  const occupied = http.createServer((_req, res) => res.end('different service'));
  const port = await listen(occupied);
  t.after(async () => {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  await assert.rejects(
    execFileAsync(process.execPath, ['--import', 'tsx', menuService, url], {
      cwd: root, env: isolatedEnv(home), timeout: 5000,
    }),
    (error: Error & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout || '', /Could not start the local service/);
      return true;
    },
  );
  assert.equal((await request(url, {}, 'GET', '/api/health')).body, 'different service');
  assert.equal(fs.existsSync(path.join(home, '.usage-console')), false);
});

test('the native menu bar on other platforms points users to the web dashboard', { skip: process.platform === 'darwin' }, async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['--import', 'tsx', cli, 'menubar'], { cwd: root, timeout: 5000 }),
    (error: Error & { code?: number; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr || '', /requires macOS.*web dashboard/);
      return true;
    },
  );
});

test('failed CLI startup exits with code 1 without starting scans or quota polling', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-startup-test-'));
  const occupied = net.createServer();
  const port = await listen(occupied);
  t.after(async () => {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const cases = [
    { env: { CONSOLE_PORT: '0' }, args: [], message: /Invalid CONSOLE_PORT/ },
    { env: { CONSOLE_HOST: '0.0.0.0' }, args: [], message: /Refusing to bind/ },
    { env: {}, args: ['--port', String(port)], message: /Port already in use/ },
  ];
  for (const item of cases) {
    await assert.rejects(
      execFileAsync(process.execPath, ['--import', 'tsx', cli, '--no-open', ...item.args], {
        cwd: root, env: isolatedEnv(home, item.env), timeout: 5000,
      }),
      (err: Error & { code?: number; killed?: boolean; stdout?: string; stderr?: string }) => {
        assert.equal(err.killed, false, 'CLI must exit on its own, not be killed by the timeout');
        assert.equal(err.code, 1);
        assert.match(err.stderr || '', item.message);
        assert.doesNotMatch(err.stdout || '', /\[UsageStore\]|\[Quota\]/);
        return true;
      },
    );
  }
  assert.equal(fs.existsSync(path.join(home, '.usage-console')), false);
});

test('API rejects cross-origin and cross-site browser requests before side effects', async (t) => {
  const url = await startCli(t);
  for (const headers of [
    {},
    { Origin: url, 'Sec-Fetch-Site': 'same-origin' },
    { 'Sec-Fetch-Site': 'none' },
  ]) {
    const result = await request(url, headers);
    assert.equal(result.status, 200);
    assert.equal(typeof JSON.parse(result.body).state, 'string');
  }
  for (const headers of [
    { Origin: 'http://127.0.0.1:19999', 'Content-Type': 'text/plain' },
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { Origin: `${url}/` },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
    { Origin: url, 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'evil.example', Origin: 'http://evil.example' },
  ]) {
    assert.equal((await request(url, headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal((await request(url, { 'Sec-Fetch-Site': 'cross-site' }, 'GET', '/api/health')).status, 403);
  assert.equal((await request(url, { Origin: 'https://evil.example' }, 'OPTIONS')).status, 403);
  assert.equal((await request(url, {}, 'GET', '/api/health')).status, 200);
});

test('Vite proxy preserves same-origin requests without authorizing other local pages', async (t) => {
  const apiUrl = await startCli(t);
  const vite = await createViteServer({
    configFile: path.join(root, 'vite.config.ts'),
    root,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: apiUrl } } },
  });
  t.after(() => vite.close());
  await vite.listen();
  const port = (vite.httpServer!.address() as net.AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await request(url, { Origin: url, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await request(url, { Origin: 'http://127.0.0.1:19999', 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await request(url, { 'Sec-Fetch-Site': 'cross-site' }, 'GET', '/api/health')).status, 403);
});
