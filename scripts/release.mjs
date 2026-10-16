import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const number = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`);

export function releaseMetadata(pkg, tag, repository) {
  if (pkg.private === true) throw new Error('Refusing to publish a private package');
  if (typeof pkg.version !== 'string' || !versionPattern.test(pkg.version)) {
    throw new Error('Use a canonical version such as 0.1.0 or 0.2.0-beta.1 (no build metadata)');
  }
  if (tag !== `v${pkg.version}`) throw new Error(`Release tag must be v${pkg.version}; got ${tag}`);
  if (repository && pkg.repository?.url !== `git+https://github.com/${repository}.git`) {
    throw new Error('package.json repository.url must match the publishing GitHub repository');
  }
  return { name: pkg.name, version: pkg.version, distTag: pkg.version.includes('-') ? 'next' : 'latest' };
}

export function archiveIntegrity(file) {
  return `sha512-${createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;
}

export function assertIntegrity(file, expected) {
  const actual = archiveIntegrity(file);
  if (actual !== expected) throw new Error('Package integrity mismatch; refusing to publish');
  return actual;
}

export function publicationDecision(integrity, published) {
  if (published === null) return 'publish';
  if (published === integrity) return 'skip';
  throw new Error('This version already exists with different contents. Bump the version; never overwrite or move its tag.');
}

export async function waitForPublishedIntegrity(integrity, read, {
  attempts = 31,
  intervalMs = 10_000,
  wait = delay,
  onPending = () => {},
} = {}) {
  // npm accepts uploads before registry indexing completes; allow up to five minutes of waiting.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const published = await read();
    if (published === integrity) return;
    if (published !== null) throw new Error('Registry integrity differs from the uploaded tarball');
    if (attempt + 1 < attempts) {
      onPending(attempt + 1, attempts);
      await wait(intervalMs);
    }
  }
  throw new Error('Publish returned successfully, but registry verification timed out. Check npm before retrying.');
}

function outputs(values) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
}

function publishedIntegrity(spec) {
  let result;
  try {
    result = execFileSync('npm', ['view', spec, 'dist.integrity', '--json', '--prefer-online', '--registry', registry], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    let code;
    try { code = JSON.parse(String(err.stdout)).error?.code; } catch { /* Not an npm JSON error. */ }
    if (code === 'E404') return null;
    throw new Error(`Cannot check ${spec}; refusing to treat an authentication/network error as an unpublished version.`, { cause: err });
  }
  const integrity = JSON.parse(result);
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`No SHA-512 integrity available for ${spec}`);
  }
  return integrity;
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tag = command === 'check' ? argument ?? process.env.GITHUB_REF_NAME ?? `v${pkg.version}` : process.env.GITHUB_REF_NAME ?? `v${pkg.version}`;
  const info = releaseMetadata(pkg, tag, process.env.GITHUB_REPOSITORY);
  if (command === 'check') {
    console.log(JSON.stringify(info));
    return;
  }
  if (command === 'pack') {
    if (!argument) throw new Error('Usage: pnpm release:pack <output-directory>');
    const directory = path.resolve(argument);
    fs.mkdirSync(directory, { recursive: true });
    // Constant shell command works with npm.cmd too; the destination is passed through the environment.
    const result = execSync('npm pack --json --foreground-scripts=false', {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_pack_destination: directory, npm_config_ignore_scripts: 'false' },
    });
    const [pack] = JSON.parse(result);
    if (pack.name !== info.name || pack.version !== info.version) throw new Error('Packed manifest does not match the release');
    const files = pack.files.map((file) => file.path);
    for (const required of ['bin/usage-console.js', 'dist/server/cli.js', 'dist/server/index.js', 'dist/client/index.html', 'LICENSE']) {
      if (!files.includes(required)) throw new Error(`Missing release file: ${required}`);
    }
    if (files.some((file) => !/^(?:bin\/|dist\/|package\.json$|README\.md$|LICENSE$)/.test(file))) {
      throw new Error('Unexpected file outside the npm package allowlist');
    }
    const archive = path.join(directory, pack.filename);
    const integrity = assertIntegrity(archive, pack.integrity);
    const file = path.join(directory, 'package.tgz');
    fs.renameSync(archive, file);
    outputs({ version: info.version, dist_tag: info.distTag, integrity });
    console.log(JSON.stringify({ ...info, file, integrity }));
    return;
  }
  if (command === 'publish') {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF_TYPE !== 'tag' || !process.env.EXPECTED_INTEGRITY) {
      throw new Error('Publishing is restricted to the tag workflow with an expected artifact integrity');
    }
    if (!argument) throw new Error('Missing tarball path');
    const [major, minor, patch] = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim().split('.').map(Number);
    if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
      throw new Error('npm 11.5.1+ is required for trusted publishing; update the publish job runtime');
    }
    const archive = path.resolve(argument);
    const integrity = assertIntegrity(archive, process.env.EXPECTED_INTEGRITY);
    const spec = `${info.name}@${info.version}`;
    if (publicationDecision(integrity, publishedIntegrity(spec)) === 'skip') {
      console.log(`${spec} already contains the identical tarball; skipping publish (no dist-tags changed).`);
      return;
    }
    // Only the final job has OIDC permission. Never rebuild or run lifecycle scripts in that job.
    execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public', '--tag', info.distTag, '--registry', registry], { stdio: 'inherit' });
    await waitForPublishedIntegrity(integrity, () => publishedIntegrity(spec), {
      onPending: (attempt, attempts) => console.log(`${spec} was accepted; waiting for npm registry indexing (${attempt}/${attempts - 1}).`),
    });
    console.log(`Verified ${spec} (${info.distTag}) against the tested tarball.`);
    return;
  }
  throw new Error('Usage: node scripts/release.mjs <check [tag] | pack <directory> | publish <tarball>>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
