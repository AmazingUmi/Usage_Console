import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { describeProxy, parseMacSystemProxy, resolveProxyEnvironment, validProxyPort } from '../src/server/network/proxy-config.js';

const execFileAsync = promisify(execFile);

test('proxy port accepts only null or integer TCP ports', () => {
  for (const value of [null, 1, 7897, 65535]) assert.equal(validProxyPort(value), true);
  for (const value of [undefined, '', '7897', 0, -1, 65536, 7.5, NaN, Infinity, {}, false]) {
    assert.equal(validProxyPort(value), false);
  }
});

test('settings override both environment proxies and preserve local bypasses', () => {
  const config = resolveProxyEnvironment(7897, {
    http_proxy: 'http://user:secret@localhost:7892', HTTPS_PROXY: 'http://127.0.0.1:7893', NO_PROXY: 'example.test',
  });
  assert.equal(config.httpProxy, 'http://127.0.0.1:7897');
  assert.equal(config.httpsProxy, config.httpProxy);
  assert.equal(config.active?.source, 'settings');
  assert.equal(config.environment?.port, 7893);
  for (const host of ['example.test', 'localhost', '127.0.0.1', '::1']) assert.ok(config.noProxy.split(',').includes(host));
  const privateEnv = resolveProxyEnvironment(null, { HTTPS_PROXY: 'http://user:secret@127.0.0.1:7897' });
  const view = JSON.stringify(describeProxy(privateEnv, null, privateEnv.environment));
  assert.equal(view.includes('secret'), false);
  assert.equal(view.includes('user'), false);
});

test('empty settings follow environment precedence, HTTPS fallback, or direct mode', () => {
  const lower = resolveProxyEnvironment(null, {
    http_proxy: 'http://localhost:7892', HTTP_PROXY: 'http://localhost:7893', https_proxy: 'http://localhost:7894', HTTPS_PROXY: 'http://localhost:7895',
  });
  assert.equal(lower.httpProxy, 'http://localhost:7892');
  assert.equal(lower.httpsProxy, 'http://localhost:7894');
  assert.equal(resolveProxyEnvironment(null, { HTTP_PROXY: 'http://localhost:7897' }).httpsProxy, 'http://localhost:7897');
  assert.equal(resolveProxyEnvironment(null, {}).active, null);
  assert.equal(resolveProxyEnvironment(null, { ALL_PROXY: 'socks5://localhost:1080' }).active, null);
});

test('system detection prefers enabled local HTTPS, falls back to HTTP and ignores SOCKS/PAC', () => {
  const https = 'HTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 7892\nHTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897';
  assert.deepEqual(parseMacSystemProxy(https), { source: 'system', host: '127.0.0.1', port: 7897 });
  assert.equal(parseMacSystemProxy(https.replace('HTTPSEnable : 1', 'HTTPSEnable : 0'))?.port, 7892);
  assert.equal(parseMacSystemProxy('SOCKSEnable : 1\nSOCKSProxy : localhost\nSOCKSPort : 1080\nProxyAutoConfigEnable : 1'), null);
  assert.equal(parseMacSystemProxy('HTTPEnable : 1\nHTTPProxy : proxy.example.test\nHTTPPort : 7897'), null);
  assert.equal(parseMacSystemProxy('HTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 65536'), null);
});

test('status distinguishes saved vs running configuration and detects port mismatches', () => {
  const runtime = resolveProxyEnvironment(7892, {});
  const detected = { source: 'system' as const, host: '127.0.0.1', port: 7897 };
  const before = describeProxy(runtime, 7892, detected);
  assert.equal(before.restartRequired, false);
  assert.equal(before.portMismatch, true);
  const saved = describeProxy(runtime, 7897, detected);
  assert.equal(saved.active?.port, 7892);
  assert.equal(saved.checkedPort, 7897);
  assert.equal(saved.restartRequired, true);
  assert.equal(saved.portMismatch, false);
  const cleared = describeProxy(runtime, null, detected);
  assert.equal(cleared.restartRequired, true);
  assert.equal(cleared.checkedPort, null);
  assert.equal(cleared.portMismatch, false);
  const inherited = describeProxy(resolveProxyEnvironment(7892, { HTTPS_PROXY: 'http://localhost:7897' }), null, detected);
  assert.equal(inherited.active?.port, 7892);
  assert.equal(inherited.checkedPort, 7897);
  assert.equal(inherited.portMismatch, false);
  assert.equal(describeProxy(runtime, 7892, null).portMismatch, false);
  const remote = resolveProxyEnvironment(null, { HTTPS_PROXY: 'https://proxy.example.test' });
  assert.equal(describeProxy(remote, null, detected).checkedPort, null);
});

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

test('explicit server fetch uses the configured proxy, bypasses localhost, and does not switch until restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'usage-proxy-test-'));
  const target = http.createServer((req, res) => { res.end(req.url); });
  const tunnels: string[] = [];
  // Newer Node agents forward plain HTTP directly; older agents tunnel it with CONNECT.
  const proxy = http.createServer((req, res) => {
    const url = new URL(req.url!);
    tunnels.push(url.host);
    const forwarded = http.request({ host: '127.0.0.1', port: targetPort, path: url.pathname, method: req.method }, (upstream) => {
      res.writeHead(upstream.statusCode!);
      upstream.pipe(res);
    });
    forwarded.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(forwarded);
  });
  const sockets = new Set<net.Socket>();
  proxy.on('connect', (req, client, head) => {
    tunnels.push(req.url!);
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
    }
  });
  const targetPort = await listen(target);
  const proxyPort = await listen(proxy);
  const settingsFile = path.join(dir, 'settings.json');
  await writeFile(settingsFile, JSON.stringify({ proxyPort }));
  const proxyModule = new URL('../src/server/network/proxy.ts', import.meta.url).href;
  const settingsModule = new URL('../src/server/settings.ts', import.meta.url).href;
  try {
    const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { initializeProxy, getProxyStatus, proxyFetch as fetch } from ${JSON.stringify(proxyModule)};
      import { saveSettings } from ${JSON.stringify(settingsModule)};
      globalThis.fetch = () => { throw new Error('Server requests must not use native global fetch'); };
      initializeProxy();
      const read = async url => (await fetch(url, { signal: AbortSignal.timeout(3000) })).text();
      const remote = 'http://proxy-target.invalid:${targetPort}/quota';
      const first = await read(remote);
      const local = await read('http://127.0.0.1:${targetPort}/health');
      const initial = await getProxyStatus();
      saveSettings({ proxyPort: ${proxyPort === 65535 ? 65534 : proxyPort + 1} });
      const second = await read(remote);
      const pending = await getProxyStatus();
      console.log(JSON.stringify({ first, local, second, initial, pending, childProxy: process.env.https_proxy }));
      process.exit(0);
    `], {
      env: {
        ...process.env, CONSOLE_SETTINGS_PATH: settingsFile, NODE_OPTIONS: '', NODE_USE_ENV_PROXY: '0',
        HTTP_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:2', NO_PROXY: '', no_proxy: '',
      },
      timeout: 15_000,
    });
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
    assert.equal(result.first, '/quota');
    assert.equal(result.second, '/quota');
    assert.equal(result.local, '/health');
    assert.equal(result.initial.listening, true);
    assert.equal(result.initial.restartRequired, false);
    assert.equal(result.pending.active.port, proxyPort);
    assert.equal(result.pending.restartRequired, true);
    assert.equal(result.childProxy, `http://127.0.0.1:${proxyPort}`);
    assert.ok(tunnels.length >= 1);
    assert.ok(tunnels.every((url) => url === `proxy-target.invalid:${targetPort}`));
  } finally {
    for (const socket of sockets) socket.destroy();
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([new Promise((resolve) => target.close(resolve)), new Promise((resolve) => proxy.close(resolve))]);
    await rm(dir, { recursive: true, force: true });
  }
});
