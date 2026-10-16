import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { archiveIntegrity, assertIntegrity, publicationDecision, releaseMetadata } from '../scripts/release.mjs';

const pkg = { name: 'usage-console', version: '0.1.0', repository: { url: 'git+https://github.com/AmazingUmi/Usage_Console.git' } };

test('release tags must exactly match a canonical, non-private package version', () => {
  assert.deepEqual(releaseMetadata(pkg, 'v0.1.0', 'AmazingUmi/Usage_Console'), { name: 'usage-console', version: '0.1.0', distTag: 'latest' });
  for (const tag of ['0.1.0', 'v0.1.1', 'main', 'v0.1.0\n']) assert.throws(() => releaseMetadata(pkg, tag), /Release tag/);
  assert.throws(() => releaseMetadata({ ...pkg, private: true }, 'v0.1.0'), /private/);
  assert.throws(() => releaseMetadata(pkg, 'v0.1.0', 'other/repo'), /repository/);
  for (const version of ['01.0.0', '1.0', '1.0.0-beta..1', '1.0.0-01', '1.0.0+build', '1.0.0\n']) {
    assert.throws(() => releaseMetadata({ ...pkg, version }, `v${version}`), /canonical version/);
  }
});

test('prereleases always publish to next, never implicitly to latest', () => {
  for (const version of ['0.2.0-beta.1', '1.0.0-rc.0', '1.0.0-preview', '1.0.0-0.beta']) {
    assert.equal(releaseMetadata({ ...pkg, version }, `v${version}`).distTag, 'next');
  }
});

test('only missing versions are published; identical retries skip and different bytes fail', () => {
  assert.equal(publicationDecision('sha512-a', null), 'publish');
  assert.equal(publicationDecision('sha512-a', 'sha512-a'), 'skip');
  for (const existing of ['sha512-b', undefined, '']) assert.throws(() => publicationDecision('sha512-a', existing), /different contents/);
});

test('artifact tampering is rejected before any registry operation', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-release-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'package.tgz');
  fs.writeFileSync(file, 'original artifact');
  const integrity = archiveIntegrity(file);
  assert.equal(assertIntegrity(file, integrity), integrity);
  fs.writeFileSync(file, 'changed artifact');
  assert.throws(() => assertIntegrity(file, integrity), /integrity mismatch/);
});

test('the publish entry point refuses local execution without invoking npm', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), 'publish', 'not-a-package.tgz'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: '', GITHUB_ACTIONS: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: `v${current.version}`, GITHUB_REPOSITORY: 'AmazingUmi/Usage_Console', EXPECTED_INTEGRITY: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restricted to the tag workflow/);
});
