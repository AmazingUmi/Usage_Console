import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin' || !process.argv[2]) {
  throw new Error('Run node scripts/build-menubar.mjs <output> on macOS.');
}

const output = path.resolve(process.argv[2]);
const source = fileURLToPath(new URL('../bin/UsageConsoleMenuBar.swift', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-console-swift-'));
const moduleCache = path.join(temporary, 'modules');

try {
  // Recent Swift toolchains omit Intel's back-deployment libraries for older macOS versions.
  const targets = ['arm64-apple-macosx11.0', 'x86_64-apple-macosx13.0'];
  const slices = targets.map((target) => {
    const file = path.join(temporary, target);
    execFileSync('/usr/bin/xcrun', ['swiftc', source, '-O', '-target', target, '-module-cache-path', moduleCache, '-o', file], { stdio: 'inherit' });
    return file;
  });
  const binary = path.join(temporary, 'UsageConsoleMenuBar');
  execFileSync('/usr/bin/xcrun', ['lipo', '-create', ...slices, '-output', binary], { stdio: 'inherit' });
  const architectures = execFileSync('/usr/bin/xcrun', ['lipo', '-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!architectures.includes('arm64') || !architectures.includes('x86_64')) {
    throw new Error('The menu bar helper must contain both arm64 and x86_64.');
  }
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', binary], { stdio: 'inherit' });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(binary, output);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
