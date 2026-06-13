const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readTasks } = require('../src/sources/tasks.js');

test('lists task session directories', () => {
  const result = readTasks(path.join(__dirname, 'fixtures', 'tasks'));
  const sess = result.find(r => r.sessionId === 'sess1');
  assert.ok(sess);
  assert.ok(typeof sess.fileCount === 'number');
});

test('returns [] for missing tasks dir', () => {
  assert.deepStrictEqual(readTasks('/no/such/dir'), []);
});
