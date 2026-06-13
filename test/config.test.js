const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

test('config resolves paths under CLAUDE_DIR override', () => {
  process.env.CLAUDE_DIR = path.join('/tmp', 'fake-claude');
  delete require.cache[require.resolve('../src/config.js')];
  const cfg = require('../src/config.js');
  assert.strictEqual(cfg.CLAUDE_DIR, path.join('/tmp', 'fake-claude'));
  assert.strictEqual(cfg.PROJECTS_DIR, path.join('/tmp', 'fake-claude', 'projects'));
  assert.strictEqual(cfg.SESSION_STATS, path.join('/tmp', 'fake-claude', '.session-stats.json'));
  assert.ok(cfg.RUNNING_THRESHOLD_MS > 0);
  assert.ok(cfg.IDLE_THRESHOLD_MS > cfg.RUNNING_THRESHOLD_MS);
});
