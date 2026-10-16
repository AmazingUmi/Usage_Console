import fs from 'node:fs';
import path from 'node:path';

/**
 * Built UI location.
 * `dist/server` looks at `dist/client`; running from `src/server` looks at `dist/client` via the repo root.
 */
export function resolveClientDist(fromDir: string): string | null {
  const candidates = [
    path.resolve(fromDir, '../client'),
    path.resolve(fromDir, '../../dist/client'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}
