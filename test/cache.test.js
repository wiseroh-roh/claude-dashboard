const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createCache } = require('../src/cache.js');

const pricing = require('../src/pricing.json');
const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const PROJECTS = path.join(__dirname, 'fixtures', 'projects');

test('refresh returns cards and overview from fixture transcripts', () => {
  const cache = createCache({ projectsDir: PROJECTS, pricing, config });
  const now = Date.parse('2026-06-13T14:31:10.000Z'); // ~6s after sess1 last activity
  const snap = cache.refresh(now);
  const card = snap.cards.find(c => c.sessionId === 'sess1');
  assert.ok(card);
  assert.strictEqual(card.status, 'running');
  assert.strictEqual(card.turns, 2);
  assert.strictEqual(snap.overview.totalSessions, snap.cards.length);
  assert.ok(snap.overview.totalSessions >= 1);
});

test('second refresh reuses cache when mtime unchanged (same result)', () => {
  const cache = createCache({ projectsDir: PROJECTS, pricing, config });
  const now = Date.parse('2026-06-13T14:31:10.000Z');
  const a = cache.refresh(now);
  const b = cache.refresh(now);
  assert.deepStrictEqual(a.overview, b.overview);
});
