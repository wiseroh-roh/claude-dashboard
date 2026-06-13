const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readSessionStats } = require('../src/sources/sessionStats.js');

test('reads session stats map', () => {
  const stats = readSessionStats(path.join(__dirname, 'fixtures', '.session-stats.json'));
  assert.strictEqual(stats.sess1.total_calls, 15);
  assert.deepStrictEqual(stats.sess1.tool_counts, { Read: 10, Bash: 5 });
});

test('returns {} for missing file', () => {
  assert.deepStrictEqual(readSessionStats('/no/such/file.json'), {});
});
