const { test } = require('node:test');
const assert = require('node:assert');
const { buildSessionCard, buildOverview } = require('../src/metrics/aggregate.js');

const pricing = {
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};
const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const now = 1_000_000_000_000;

const summary = {
  sessionId: 'sess1', project: 'proj-a', model: 'claude-opus-4-8',
  turns: 2, tokens: { input: 1_000_000, output: 0, cacheCreate: 0, cacheRead: 0 },
  firstTs: now - 120_000, lastTs: now - 30_000, avgResponseMs: 3000, hasError: false,
};

test('buildSessionCard adds status and cost', () => {
  const card = buildSessionCard(summary, { pricing, now, config });
  assert.strictEqual(card.status, 'running');
  assert.strictEqual(card.costUsd, 15);
  assert.strictEqual(card.sessionId, 'sess1');
  assert.strictEqual(card.turns, 2);
});

test('buildOverview totals across cards', () => {
  const cards = [
    buildSessionCard(summary, { pricing, now, config }),
    buildSessionCard({ ...summary, sessionId: 's2', lastTs: now - 3_600_000, avgResponseMs: 1000,
      tokens: { input: 0, output: 1_000_000, cacheCreate: 0, cacheRead: 0 } }, { pricing, now, config }),
  ];
  const ov = buildOverview(cards);
  assert.strictEqual(ov.totalSessions, 2);
  assert.strictEqual(ov.runningSessions, 1);
  assert.strictEqual(ov.totalTurns, 4);
  assert.strictEqual(ov.totalInputTokens, 1_000_000);
  assert.strictEqual(ov.totalOutputTokens, 1_000_000);
  assert.strictEqual(ov.avgResponseMs, 2000); // (3000+1000)/2
  assert.strictEqual(ov.estimatedCostUsd, 90); // 15 + 75
});

test('buildOverview avgResponseMs is null when no latencies', () => {
  const cards = [buildSessionCard({ ...summary, avgResponseMs: null }, { pricing, now, config })];
  assert.strictEqual(cards[0].avgResponseMs, null);
  assert.strictEqual(buildOverview(cards).avgResponseMs, null);
});
