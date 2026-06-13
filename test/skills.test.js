const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readSkills } = require('../src/sources/skills.js');

const FIX = path.join(__dirname, 'fixtures');

test('lists plugins with enabled flag and version', () => {
  const plugins = readSkills(
    path.join(FIX, 'plugins', 'installed_plugins.json'),
    path.join(FIX, 'settings.json'),
  );
  const byName = Object.fromEntries(plugins.map(p => [p.name, p]));
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].enabled, true);
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].version, '5.1.0');
  assert.strictEqual(byName['oh-my-claudecode@omc'].enabled, false);
});

test('returns [] when installed file missing', () => {
  assert.deepStrictEqual(readSkills('/no/a.json', '/no/b.json'), []);
});
