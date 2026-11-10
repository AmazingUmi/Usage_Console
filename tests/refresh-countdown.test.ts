import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClock } from '../src/client/lib/format.ts';

test('header refresh clock ticks as m:ss, and h:mm:ss past an hour', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-5_000), '0:00');
  assert.equal(formatClock(Number.NaN), '0:00');
  assert.equal(formatClock(9_000), '0:09');
  assert.equal(formatClock(8_200), '0:09');
  assert.equal(formatClock(60_000), '1:00');
  assert.equal(formatClock(125_000), '2:05');
  assert.equal(formatClock(3_600_000), '1:00:00');
  assert.equal(formatClock(3_750_000), '1:02:30');
});
