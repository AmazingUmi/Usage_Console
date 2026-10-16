import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCountdownLeft } from '../src/client/lib/format.ts';

test('refresh countdown label is remaining time, never a word', () => {
  assert.equal(formatCountdownLeft(0), '0s');
  assert.equal(formatCountdownLeft(45_000), '45s');
  assert.equal(formatCountdownLeft(60_000), '1m');
  assert.equal(formatCountdownLeft(61_000), '2m');
  assert.equal(formatCountdownLeft(120_000), '2m');
  assert.equal(formatCountdownLeft(3_600_000), '1h');
});
