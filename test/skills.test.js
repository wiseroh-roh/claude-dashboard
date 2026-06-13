const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
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
  // plugins without an installPath get an empty skills list (graceful)
  assert.deepStrictEqual(byName['oh-my-claudecode@omc'].skills, []);
});

test('reads per-plugin skills with name and description from SKILL.md', () => {
  // Build an installed_plugins.json whose installPath points at the fixture plugin.
  const tmp = path.join(os.tmpdir(), `skills-test-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({
    version: 2,
    plugins: { 'demo@local': [{ scope: 'user', version: '1.0.0', installPath: path.join(FIX, 'sp-plugin') }] },
  }));
  try {
    const plugins = readSkills(tmp, path.join(FIX, 'settings.json'));
    const demo = plugins.find(p => p.name === 'demo@local');
    assert.ok(demo);
    assert.strictEqual(demo.skills.length, 1);
    assert.strictEqual(demo.skills[0].name, 'demo-skill');
    assert.match(demo.skills[0].description, /frontmatter extraction/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('returns [] when installed file missing', () => {
  assert.deepStrictEqual(readSkills('/no/a.json', '/no/b.json'), []);
});
