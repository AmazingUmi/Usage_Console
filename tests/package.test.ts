import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('npm pack builds a clean source snapshot and includes the published CLI and UI', async (t) => {
  // Native realpath expands Windows TEMP's 8.3 aliases (RUNNER~1), unlike Node 20's JS fallback.
  // Vite/Rollup must see the same canonical root for the clean source and HTML entry point.
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pack-test-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  fs.mkdirSync(source);
  for (const name of [
    'package.json', 'bin', 'src', 'README.md', 'LICENSE', 'index.html',
    'postcss.config.js', 'tailwind.config.js', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts',
  ]) fs.cpSync(path.join(root, name), path.join(source, name), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(fs.existsSync(path.join(source, 'dist')), false);
  const npmrc = path.join(temp, '.npmrc');
  fs.writeFileSync(npmrc, '');
  const env = {
    ...process.env,
    HOME: temp,
    USERPROFILE: temp,
    npm_config_userconfig: npmrc,
    npm_config_cache: path.join(temp, 'cache'),
    npm_config_ignore_scripts: 'false',
    npm_config_foreground_scripts: 'false',
  };
  // cmd is needed for npm.cmd on Windows; the shell command is constant, with no interpolated paths.
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --json'] : ['pack', '--json'];
  const { stdout } = await execFileAsync(command, args, { cwd: source, env, timeout: 60_000 });
  const [pack] = JSON.parse(stdout) as { filename: string; files: { path: string }[] }[];
  const files = pack.files.map((file) => file.path);
  for (const name of ['bin/usage-console.js', 'dist/server/cli.js', 'dist/server/index.js', 'dist/client/index.html', 'LICENSE']) {
    assert.ok(files.includes(name), `${name} must be in the tarball`);
  }
  assert.ok(files.some((name) => /^dist\/client\/assets\/.*\.js$/.test(name)));
  assert.ok(files.some((name) => /^dist\/client\/assets\/.*\.css$/.test(name)));
  assert.equal(files.some((name) => /^(?:src|tests|node_modules)\//.test(name)), false);
  assert.ok(fs.statSync(path.join(source, pack.filename)).size > 0);
  const result = await execFileAsync(process.execPath, [path.join(source, 'bin/usage-console.js'), '--version'], { cwd: temp, env, timeout: 5000 });
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  assert.equal(result.stdout.trim(), pkg.version);
});
