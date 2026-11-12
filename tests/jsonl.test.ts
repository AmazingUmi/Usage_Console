import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readJsonlLines, readJsonlLinesSync } from '../src/server/usage/jsonl.ts';

test('JSONL readers preserve UTF-8 across chunks, blank lines, CRLF and the final line', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-jsonl-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  const prefix = '{"text":"';
  const content = `${prefix}${'x'.repeat(64 * 1024 - prefix.length - 1)}水😀"}\r\n\n{"ok":true}`;
  fs.writeFileSync(file, content);

  const expected = content.split('\n');
  assert.deepEqual([...readJsonlLinesSync(file)], expected);
  const streamed: string[] = [];
  for await (const line of readJsonlLines(file)) streamed.push(line);
  assert.deepEqual(streamed, expected);
});
