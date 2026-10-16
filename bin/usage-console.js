#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist/server/cli.js');
if (!fs.existsSync(entry)) {
  console.error('usage-console 尚未构建。请在项目目录执行 pnpm build。\nusage-console is not built. Run pnpm build in the project directory.');
  process.exit(1);
}

const { main } = await import(pathToFileURL(entry).href);
await main();
