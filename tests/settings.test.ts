import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSettings, saveSettings } from '../src/server/settings.js';

test('legacy settings default to environment; proxy saves validate, persist and preserve unrelated settings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'usage-settings-test-'));
  const previous = process.env.CONSOLE_SETTINGS_PATH;
  const file = path.join(dir, 'settings.json');
  process.env.CONSOLE_SETTINGS_PATH = file;
  await writeFile(file, JSON.stringify({ quotaRefreshIntervalSeconds: 300, hideAgyClaude: false }));
  try {
    assert.equal(loadSettings().proxyPort, null);
    const saved = saveSettings({ proxyPort: 7897 });
    assert.equal(saved.proxyPort, 7897);
    assert.equal(saved.quotaRefreshIntervalSeconds, 300);
    assert.equal(saved.hideAgyClaude, false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).proxyPort, 7897);
    for (const value of [0, -1, 65536, 7.5, '7897', false]) {
      assert.throws(() => saveSettings({ proxyPort: value as number }));
      assert.equal(loadSettings().proxyPort, 7897);
    }
    assert.equal(saveSettings({ hideAgyClaude: true }).proxyPort, 7897);
    assert.equal(saveSettings({ proxyPort: null }).proxyPort, null);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).proxyPort, null);
  } finally {
    if (previous === undefined) delete process.env.CONSOLE_SETTINGS_PATH;
    else process.env.CONSOLE_SETTINGS_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
