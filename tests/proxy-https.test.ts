import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'NO_PROXY', 'no_proxy'];

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

test('HTTPS quota, login and token refresh use saved proxy with no environment flags or global fetch', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'usage-https-proxy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  const conf = path.join(dir, 'openssl.cnf');
  await writeFile(conf, `[req]
prompt = no
distinguished_name = dn
x509_extensions = ext
[dn]
CN = Usage Console temporary test CA
[ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = DNS:chatgpt.com,DNS:cli-chat-proxy.grok.com,DNS:api.anthropic.com,DNS:auth.openai.com,DNS:auth.x.ai,DNS:platform.claude.com,DNS:console.anthropic.com,IP:127.0.0.1
`);
  try {
    await execFileAsync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-keyout', keyFile, '-out', certFile, '-config', conf], { timeout: 15_000 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { t.skip('openssl is not installed'); return; }
    throw err;
  }

  const requests: string[] = [];
  const target = https.createServer({ key: await readFile(keyFile), cert: await readFile(certFile) }, (req, res) => {
    requests.push(`${req.method} ${req.headers.host}${req.url}`);
    let body: unknown = { ok: true };
    switch (req.url) {
      case '/backend-api/wham/usage': body = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 25 } } }; break;
      case '/v1/billing?format=credits': body = { config: { creditUsagePercent: 30 } }; break;
      case '/api/oauth/profile': body = { account: { uuid: 'test-claude' }, organization: { subscription_type: 'pro' } }; break;
      case '/api/oauth/usage': body = { five_hour: { utilization: 42 } }; break;
      case '/api/accounts/deviceauth/usercode': body = { device_auth_id: 'test-codex', user_code: 'TEST', interval: 5 }; break;
      case '/oauth2/device/code': body = { device_code: 'test-grok', user_code: 'TEST', verification_uri: 'https://example.invalid', interval: 5 }; break;
      case '/oauth/token':
      case '/oauth2/token':
      case '/v1/oauth/token': body = { access_token: 'test-new-access', refresh_token: 'test-new-refresh', expires_in: 3600 }; break;
    }
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  const tunnels: string[] = [];
  const sockets = new Set<net.Socket>();
  const proxy = http.createServer((_req, res) => { res.writeHead(500); res.end('Expected an HTTPS CONNECT tunnel'); });
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
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([new Promise((resolve) => target.close(resolve)), new Promise((resolve) => proxy.close(resolve))]);
  });
  const targetPort = await listen(target);
  const proxyPort = await listen(proxy);
  const settingsFile = path.join(dir, 'settings.json');
  await writeFile(settingsFile, JSON.stringify({ proxyPort, dataDir: path.join(dir, 'data') }));
  const moduleUrl = (name: string) => JSON.stringify(new URL(`../src/server/${name}.ts`, import.meta.url).href);
  const env: NodeJS.ProcessEnv = { ...process.env, CONSOLE_SETTINGS_PATH: settingsFile, NODE_EXTRA_CA_CERTS: certFile };
  for (const key of [...PROXY_ENV_KEYS, 'NODE_TLS_REJECT_UNAUTHORIZED']) delete env[key];
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { Agent, setGlobalDispatcher } from 'undici';
    import { initializeProxy, proxyFetch } from ${moduleUrl('network/proxy')};
    import { fetchLiveCodexQuota, fetchLiveGrokQuota } from ${moduleUrl('quota/oauth')};
    import { fetchClaudeAccountQuota } from ${moduleUrl('identity/claude-account')};
    import { startCodexLogin, startGrokLogin } from ${moduleUrl('identity/login')};
    import { withToken } from ${moduleUrl('identity/credentials')};
    const clean = ${JSON.stringify(PROXY_ENV_KEYS)}.every(key => process.env[key] === undefined);
    globalThis.fetch = () => { throw new Error('Native global fetch must not be used'); };
    initializeProxy();
    // A different module may replace global dispatcher state; that must not affect our owned transport.
    setGlobalDispatcher(new Agent({ connect: { lookup(_host, _options, done) { done(new Error('Global dispatcher must not be used')); } } }));
    const credential = { accountId: 'test-claude', access: 'test-access', refresh: 'test-refresh', expires: Date.now()+3600000, updatedAt: Date.now() };
    const quotas = await Promise.all([
      fetchLiveCodexQuota('test-access', 'test-codex'),
      fetchLiveGrokQuota('test-access'),
      fetchClaudeAccountQuota(credential, 'Claude'),
    ]);
    const logins = await Promise.all([startCodexLogin(), startGrokLogin()]);
    const refreshes = [];
    for (const provider of ['gpt', 'grok', 'claude']) {
      refreshes.push(await withToken(provider, { ...credential, accountId: 'refresh-'+provider, expires: 0 }, async token => token, () => false));
    }
    const local = await (await proxyFetch('https://127.0.0.1:${targetPort}/bypass', { signal: AbortSignal.timeout(3000) })).json();
    console.log(JSON.stringify({ clean, statuses: quotas.map(q=>q.status), remaining: quotas.map(q=>q.windows[0].remainingPercent), logins: logins.length, refreshes, local }));
    process.exit(0);
  `], { env, timeout: 20_000 });
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.equal(result.clean, true);
  assert.deepEqual(result.statuses, ['ok', 'ok', 'ok']);
  assert.deepEqual(result.remaining, [75, 70, 58]);
  assert.equal(result.logins, 2);
  assert.deepEqual(result.refreshes, ['test-new-access', 'test-new-access', 'test-new-access']);
  assert.deepEqual(result.local, { ok: true });
  for (const host of ['chatgpt.com', 'cli-chat-proxy.grok.com', 'api.anthropic.com', 'auth.openai.com', 'auth.x.ai', 'platform.claude.com']) {
    assert.ok(tunnels.includes(`${host}:443`), `${host} must use the proxy tunnel`);
  }
  assert.ok(tunnels.every((host) => host.endsWith(':443')), 'Loopback HTTPS must bypass the proxy');
  assert.ok(requests.some((request) => request.includes('POST auth.openai.com/oauth/token')));
  assert.ok(requests.some((request) => request.includes('POST auth.x.ai/oauth2/token')));
  assert.ok(requests.some((request) => request.includes('POST platform.claude.com/v1/oauth/token')));
});
