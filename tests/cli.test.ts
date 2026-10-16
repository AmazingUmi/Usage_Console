import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, packageVersion } from '../src/server/cli.ts';
import { resolveClientDist } from '../src/server/client-dist.ts';
import {
  browserUrl,
  isLoopbackRequestHost,
  resolveListenHost,
  resolveListenPort,
} from '../src/server/listen.ts';

test('parseArgs accepts the published command flags', () => {
  assert.deepEqual(parseArgs(['--no-open', '--port', '4010', '--host=127.0.0.1']), {
    help: false,
    version: false,
    open: false,
    allowRemote: false,
    port: 4010,
    host: '127.0.0.1',
  });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-V']).version, true);
  assert.equal(parseArgs(['--allow-remote', '--host', '0.0.0.0']).allowRemote, true);
});

test('parseArgs rejects a bad port, unknown flag, or unauthenticated remote bind', () => {
  assert.throws(() => parseArgs(['--port', '0']), /Invalid port/);
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
  assert.throws(() => parseArgs(['--host', '0.0.0.0']), /allow-remote/);
});

test('CLI host accepts either environment or flag authorization for a remote bind', () => {
  const args = ['--host', '0.0.0.0', '--no-open'];
  assert.equal(parseArgs(args, { CONSOLE_ALLOW_REMOTE: '1' }).host, '0.0.0.0');
  assert.equal(parseArgs([...args, '--allow-remote'], { CONSOLE_ALLOW_REMOTE: '0' }).allowRemote, true);
  for (const value of [undefined, '0', 'true']) {
    assert.throws(() => parseArgs(args, { CONSOLE_ALLOW_REMOTE: value }), /allow-remote/);
  }
});

test('listen address ignores HOST and PORT, including the old 30141 exception', () => {
  const env = { HOST: '0.0.0.0', PORT: '30141', CONSOLE_PORT: '', CONSOLE_HOST: '' } as NodeJS.ProcessEnv;
  assert.equal(resolveListenPort(env), 3001);
  assert.equal(resolveListenHost(env), '127.0.0.1');
  assert.equal(resolveListenPort({ CONSOLE_PORT: '4010' }), 4010);
  assert.throws(() => resolveListenPort({ CONSOLE_PORT: '0' }), /Invalid CONSOLE_PORT/);
  assert.throws(() => resolveListenHost({ CONSOLE_HOST: '0.0.0.0' }), /Refusing to bind/);
  assert.equal(resolveListenHost({ CONSOLE_HOST: '0.0.0.0', CONSOLE_ALLOW_REMOTE: '1' }), '0.0.0.0');
  assert.equal(resolveListenHost({ CONSOLE_HOST: '[::1]' }), '::1');
});

test('loopback requests are recognized from the Host header, not a lookalike name', () => {
  assert.equal(isLoopbackRequestHost('127.0.0.1:3001'), true);
  assert.equal(isLoopbackRequestHost('localhost:3001'), true);
  assert.equal(isLoopbackRequestHost('[::1]:3001'), true);
  assert.equal(isLoopbackRequestHost('evil.example:3001'), false);
  assert.equal(isLoopbackRequestHost('127.0.0.1.evil.example'), false);
  assert.equal(isLoopbackRequestHost(undefined), false);
  assert.equal(browserUrl('0.0.0.0', 3001), 'http://127.0.0.1:3001');
  assert.equal(browserUrl('::1', 3001), 'http://[::1]:3001');
});

test('package version is read from the repo package.json', () => {
  assert.match(packageVersion(path.resolve('src/server')), /^\d+\.\d+\.\d+/);
});

test('client dist resolves the built UI, not the source tree', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-console-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fromCompiled = path.join(root, 'dist/server');
  fs.mkdirSync(fromCompiled, { recursive: true });
  fs.mkdirSync(path.join(root, 'dist/client'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/client/index.html'), '<!doctype html>');
  assert.equal(resolveClientDist(fromCompiled), path.join(root, 'dist/client'));

  const fromSource = path.join(root, 'src/server');
  fs.mkdirSync(fromSource, { recursive: true });
  assert.equal(resolveClientDist(fromSource), path.join(root, 'dist/client'));
});
