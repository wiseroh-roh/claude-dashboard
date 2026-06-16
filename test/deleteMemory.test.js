const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moveMemoryToTrash } = require('../src/actions/deleteMemory.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-memdel-')); }

test('moves a memory file into the trash dir with a collision-safe name', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const memDir = path.join(projectsDir, 'p', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const file = path.join(memDir, 'a.md');
  fs.writeFileSync(file, 'note\n');
  const trashDir = path.join(root, '.trash', 'memory');

  const { trashedTo } = moveMemoryToTrash({ projectsDir, trashDir, project: 'p', name: 'a.md', now: 999 });

  assert.strictEqual(fs.existsSync(file), false, 'original removed');
  assert.strictEqual(fs.existsSync(trashedTo), true, 'trash copy exists');
  assert.strictEqual(path.basename(trashedTo), 'p__999__a.md');
});

test('rejects a name with traversal (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  assert.throws(
    () => moveMemoryToTrash({ projectsDir, trashDir: path.join(root, '.trash'), project: 'p', name: '../../secret.md', now: 1 }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing memory file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(path.join(projectsDir, 'p', 'memory'), { recursive: true });
  assert.throws(
    () => moveMemoryToTrash({ projectsDir, trashDir: path.join(root, '.trash'), project: 'p', name: 'nope.md', now: 1 }),
    (e) => e.code === 'ENOENT'
  );
});
