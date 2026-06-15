const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readMemoryFile } = require('../src/sources/memoryFile.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-mem-')); }

test('reads a memory file content', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const memDir = path.join(projectsDir, 'p', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'a.md'), 'hello memory\n');

  const { content } = readMemoryFile({ projectsDir, project: 'p', name: 'a.md' });
  assert.strictEqual(content, 'hello memory\n');
});

test('rejects a name with traversal (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  assert.throws(
    () => readMemoryFile({ projectsDir, project: 'p', name: '../../secret.md' }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing memory file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(path.join(projectsDir, 'p', 'memory'), { recursive: true });
  assert.throws(
    () => readMemoryFile({ projectsDir, project: 'p', name: 'nope.md' }),
    (e) => e.code === 'ENOENT'
  );
});
