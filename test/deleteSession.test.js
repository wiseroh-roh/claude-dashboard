const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moveSessionToTrash } = require('../src/actions/deleteSession.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-del-')); }

test('moves a session file into the trash dir with a collision-safe name', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const projDir = path.join(projectsDir, 'p');
  fs.mkdirSync(projDir, { recursive: true });
  const file = path.join(projDir, 'x.jsonl');
  fs.writeFileSync(file, '{"sessionId":"x"}\n');
  const trashDir = path.join(root, '.trash', 'sessions');

  const { trashedTo } = moveSessionToTrash({ file, projectsDir, trashDir, project: 'p', sessionId: 'x', now: 1234 });

  assert.strictEqual(fs.existsSync(file), false, 'original removed');
  assert.strictEqual(fs.existsSync(trashedTo), true, 'trash copy exists');
  assert.strictEqual(path.basename(trashedTo), 'p__x__1234.jsonl');
});

test('refuses a file outside projectsDir (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  const outside = path.join(root, 'evil.jsonl');
  fs.writeFileSync(outside, 'x');
  assert.throws(
    () => moveSessionToTrash({ file: outside, projectsDir, trashDir: path.join(root, '.trash'), project: 'p', sessionId: 'e', now: 1 }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  const missing = path.join(projectsDir, 'nope.jsonl');
  assert.throws(
    () => moveSessionToTrash({ file: missing, projectsDir, trashDir: path.join(root, '.trash'), project: 'p', sessionId: 'n', now: 1 }),
    (e) => e.code === 'ENOENT'
  );
});
