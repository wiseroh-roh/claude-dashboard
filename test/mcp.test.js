const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readMcpServers } = require('../src/sources/mcp.js');

const FIX = path.join(__dirname, 'fixtures');

test('merges configured servers and auth-needing servers', () => {
  const servers = readMcpServers(
    path.join(FIX, 'claude.json'),
    path.join(FIX, 'mcp-needs-auth-cache.json'),
  );
  const byName = Object.fromEntries(servers.map(s => [s.name, s]));
  assert.strictEqual(byName['local-fs'].needsAuth, false);
  assert.strictEqual(byName['local-fs'].configured, true);
  assert.strictEqual(byName['claude.ai Slack'].needsAuth, true);
});

test('returns [] when both files missing', () => {
  assert.deepStrictEqual(readMcpServers('/no/a.json', '/no/b.json'), []);
});
