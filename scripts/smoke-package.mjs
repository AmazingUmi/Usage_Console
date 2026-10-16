import assert from 'node:assert/strict';
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!process.argv[2]) throw new Error('Usage: node scripts/smoke-package.mjs <tarball>');
const archive = path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-release-smoke-'));
// Always connect directly to loopback, even if the parent Node process enables environment proxies.
const agent = new http.Agent({ proxyEnv: {} });
function get(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent, timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', body }));
    });
    req.once('timeout', () => req.destroy(new Error('Smoke HTTP request timed out')));
    req.once('error', reject);
  });
}
let child;
let closed;
let output = '';
try {
  fs.copyFileSync(archive, path.join(temp, 'package.tgz'));
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const npmrc = path.join(temp, 'npmrc');
  fs.writeFileSync(npmrc, '');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:npm_config_.*|node_auth_token|npm_token|https?_proxy|all_proxy|no_proxy|console_.*|node_options|node_use_env_proxy|claude_config_dir|agy_binary)$/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), CLAUDE_CONFIG_DIR: '',
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    CONSOLE_SETTINGS_PATH: path.join(home, 'settings.json'), npm_config_userconfig: npmrc, npm_config_cache: path.join(temp, 'cache'),
  });
  // No interpolated shell arguments, including on Windows. Everything is installed outside the checkout.
  execSync('npm install --global --prefix install ./package.tgz --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/', {
    cwd: temp, env, stdio: 'inherit', timeout: 120_000,
  });
  const modules = process.platform === 'win32' ? 'node_modules' : 'lib/node_modules';
  const entry = path.join(temp, 'install', modules, pkg.name, 'bin/usage-console.js');
  const version = execFileSync(process.execPath, [entry, '--version'], { cwd: temp, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(version.trim(), pkg.version);
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  child = spawn(process.execPath, [entry, '--no-open', '--port', String(port)], {
    cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  closed = new Promise((resolve) => child.once('close', resolve));
  child.on('error', (err) => { output += err.message; });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const res = await get(`${url}/api/health`, 500);
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.body).status, 'ok');
      break;
    } catch {
      if (Date.now() > deadline || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Installed server did not become healthy:\n${output}`);
      }
      await delay(50);
    }
  }
  const page = await get(url);
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  const assets = [...page.body.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith('.js')));
  assert.ok(assets.some((asset) => asset.endsWith('.css')));
  for (const asset of assets) {
    const assetUrl = new URL(asset, url);
    assert.equal(assetUrl.origin, url);
    const res = await get(assetUrl);
    assert.equal(res.status, 200);
    assert.match(res.type, asset.endsWith('.css') ? /text\/css/ : /javascript/);
    assert.ok(res.body.length > 1000);
  }
  console.log(`Installed ${pkg.name}@${pkg.version}: CLI, health, HTML, JS and CSS passed (isolated HOME).`);
} finally {
  agent.destroy();
  if (child) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
}
