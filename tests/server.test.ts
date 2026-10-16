import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'src/server/cli.ts');

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

async function startCli(t: TestContext): Promise<string> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-server-test-'));
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
    fs.rmSync(home, { recursive: true, force: true });
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

async function request(base: string, headers: http.OutgoingHttpHeaders = {}, method = 'POST', route = '/api/login/claude/start') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(new URL(route, base), { method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

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
