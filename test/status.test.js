const { test } = require('node:test');
const assert = require('node:assert');
const { computeStatus } = require('../src/metrics/status.js');

const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const now = 1_000_000_000_000;

test('error wins regardless of recency', () => {
  assert.strictEqual(computeStatus({ lastTs: now, hasError: true }, now, config), 'error');
});

test('running when activity within running threshold', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 30_000, hasError: false }, now, config), 'running');
});

test('waiting when between running and idle thresholds', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 300_000, hasError: false }, now, config), 'waiting');
});

test('idle when older than idle threshold', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 3_600_000, hasError: false }, now, config), 'idle');
});

test('idle when lastTs is null', () => {
  assert.strictEqual(computeStatus({ lastTs: null, hasError: false }, now, config), 'idle');
});
