const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readMemory } = require('../src/sources/memory.js');

const PROJECTS = path.join(__dirname, 'fixtures', 'projects');

test('lists memory files per project', () => {
  const result = readMemory(PROJECTS);
  const projA = result.find(r => r.project === 'proj-a');
  assert.ok(projA);
  const names = projA.files.map(f => f.name).sort();
  assert.deepStrictEqual(names, ['MEMORY.md', 'some-fact.md']);
});

test('returns [] for missing projects dir', () => {
  assert.deepStrictEqual(readMemory('/no/such/dir'), []);
});
