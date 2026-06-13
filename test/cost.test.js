const { test } = require('node:test');
const assert = require('node:assert');
const { computeCost } = require('../src/metrics/cost.js');

const pricing = {
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

test('computes cost per million tokens for known model', () => {
  const tokens = { input: 1_000_000, output: 1_000_000, cacheCreate: 0, cacheRead: 0 };
  // 1M input * $15 + 1M output * $75 = 90
  assert.strictEqual(computeCost(tokens, 'claude-opus-4-8', pricing), 90);
});

test('includes cache tokens', () => {
  const tokens = { input: 0, output: 0, cacheCreate: 1_000_000, cacheRead: 2_000_000 };
  // 1M*18.75 + 2M*1.5 = 21.75
  assert.strictEqual(computeCost(tokens, 'claude-opus-4-8', pricing), 21.75);
});

test('falls back to default pricing for unknown model', () => {
  const tokens = { input: 1_000_000, output: 0, cacheCreate: 0, cacheRead: 0 };
  assert.strictEqual(computeCost(tokens, 'mystery-model', pricing), 3);
});

test('handles null model and missing token fields', () => {
  assert.strictEqual(computeCost({ input: 1_000_000 }, null, pricing), 3);
});
