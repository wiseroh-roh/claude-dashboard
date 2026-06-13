const { test } = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter } = require('../src/sources/frontmatter.js');

test('parses top-level scalar keys and strips quotes', () => {
  const text = '---\nname: brainstorming\ndescription: "Use before any creative work"\n---\n# body\n';
  const fm = parseFrontmatter(text);
  assert.strictEqual(fm.name, 'brainstorming');
  assert.strictEqual(fm.description, 'Use before any creative work');
});

test('flattens nested scalar keys (e.g. metadata.type) to leaf name', () => {
  const text = '---\nname: x\nmetadata:\n  node_type: memory\n  type: project\n---\n';
  const fm = parseFrontmatter(text);
  assert.strictEqual(fm.name, 'x');
  assert.strictEqual(fm.type, 'project'); // nested leaf captured
});

test('top-level key wins over a later nested key with the same leaf name', () => {
  const text = '---\nname: top\nmeta:\n  name: nested\n---\n';
  assert.strictEqual(parseFrontmatter(text).name, 'top');
});

test('returns {} when no frontmatter fence', () => {
  assert.deepStrictEqual(parseFrontmatter('# just markdown\n'), {});
  assert.deepStrictEqual(parseFrontmatter(''), {});
  assert.deepStrictEqual(parseFrontmatter(null), {});
});
