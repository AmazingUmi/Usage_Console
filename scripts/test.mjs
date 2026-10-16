import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Windows shells do not expand globs, and older Node test runners do not expand them either.
const files = readdirSync(path.join(root, 'tests'))
  .filter((name) => /\.test\.(?:ts|mjs)$/.test(name))
  .sort()
  .map((name) => path.join(root, 'tests', name));
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
