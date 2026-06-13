const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { parseTranscript, listTranscripts } = require('../src/sources/sessions.js');

const FIX = path.join(__dirname, 'fixtures', 'projects');

test('parseTranscript aggregates tokens, turns, latency and skips bad lines', () => {
  const s = parseTranscript(path.join(FIX, 'proj-a', 'sess1.jsonl'), 'proj-a');
  assert.strictEqual(s.sessionId, 'sess1');
  assert.strictEqual(s.project, 'proj-a');
  assert.strictEqual(s.model, 'claude-opus-4-8');
  assert.strictEqual(s.turns, 2);
  assert.deepStrictEqual(s.tokens, { input: 300, output: 130, cacheCreate: 10, cacheRead: 25 });
  assert.strictEqual(s.hasError, false);
  // latencies: 2s and 4s -> avg 3000ms
  assert.strictEqual(s.avgResponseMs, 3000);
  assert.strictEqual(s.firstTs, Date.parse('2026-06-13T14:30:00.000Z'));
  assert.strictEqual(s.lastTs, Date.parse('2026-06-13T14:31:04.000Z'));
});

test('listTranscripts finds jsonl files with project and mtime', () => {
  const list = listTranscripts(FIX);
  const found = list.find(x => x.file.endsWith('sess1.jsonl'));
  assert.ok(found);
  assert.strictEqual(found.project, 'proj-a');
  assert.ok(typeof found.mtimeMs === 'number');
});

test('listTranscripts returns [] for missing dir', () => {
  assert.deepStrictEqual(listTranscripts('/no/such/dir'), []);
});
