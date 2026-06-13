const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readInstall } = require('../src/sources/install.js');

const FIX = path.join(__dirname, 'fixtures');

function read() {
  return readInstall({
    claudeJson: path.join(FIX, 'claude.json'),
    installedPlugins: path.join(FIX, 'plugins', 'installed_plugins.json'),
    marketplaces: path.join(FIX, 'plugins', 'known_marketplaces.json'),
    lastUpdate: path.join(FIX, 'last-update-result.json'),
    settings: path.join(FIX, 'settings.json'),
    projectsDir: path.join(FIX, 'projects'),
  });
}

test('reports Claude Code version and a failed update', () => {
  const { claudeCode } = read();
  // no `version` in fixture transcripts -> falls back to update.versionFrom
  assert.strictEqual(claudeCode.version, '2.0.0');
  assert.strictEqual(claudeCode.update.outcome, 'failed');
  assert.strictEqual(claudeCode.update.versionTo, '2.0.1');
  assert.strictEqual(claudeCode.update.errorCode, 'update_apply_exe_locked');
});

test('lists installed plugins with enabled flag', () => {
  const { plugins } = read();
  const byName = Object.fromEntries(plugins.map(p => [p.name, p]));
  assert.strictEqual(plugins.length, 2);
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].enabled, true);
  assert.strictEqual(byName['oh-my-claudecode@omc'].enabled, false);
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].version, '5.1.0');
});

test('lists marketplaces with their source', () => {
  const { marketplaces } = read();
  assert.strictEqual(marketplaces.length, 1);
  assert.strictEqual(marketplaces[0].name, 'demo-market');
  assert.strictEqual(marketplaces[0].source, 'acme/demo');
});

test('degrades gracefully when files are missing', () => {
  const r = readInstall({
    claudeJson: '/no/a', installedPlugins: '/no/b', marketplaces: '/no/c',
    lastUpdate: '/no/d', settings: '/no/e', projectsDir: '/no/f',
  });
  assert.deepStrictEqual(r.plugins, []);
  assert.deepStrictEqual(r.marketplaces, []);
  assert.strictEqual(r.claudeCode.update, null);
  assert.strictEqual(r.claudeCode.version, null);
});
