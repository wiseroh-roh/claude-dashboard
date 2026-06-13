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
  assert.strictEqual(byName['local-fs'].status, 'connected');
  assert.strictEqual(byName['claude.ai Slack'].needsAuth, true);
  assert.strictEqual(byName['claude.ai Slack'].status, 'needs_auth');
});

test('marks ever-connected claude.ai servers as connected/usable', () => {
  const servers = readMcpServers(
    path.join(FIX, 'claude.json'),
    path.join(FIX, 'mcp-needs-auth-cache.json'),
  );
  const ctx = servers.find(s => s.name === 'claude.ai Context7');
  assert.ok(ctx, 'Context7 should be listed from claudeAiMcpEverConnected');
  assert.strictEqual(ctx.everConnected, true);
  assert.strictEqual(ctx.needsAuth, false);
  assert.strictEqual(ctx.status, 'connected');
});

test('sorts connected servers before needs-auth servers', () => {
  const servers = readMcpServers(
    path.join(FIX, 'claude.json'),
    path.join(FIX, 'mcp-needs-auth-cache.json'),
  );
  const firstNeedsAuth = servers.findIndex(s => s.status === 'needs_auth');
  const lastConnected = servers.map(s => s.status).lastIndexOf('connected');
  assert.ok(lastConnected < firstNeedsAuth, 'connected should come before needs_auth');
});

test('returns [] when both files missing', () => {
  assert.deepStrictEqual(readMcpServers('/no/a.json', '/no/b.json'), []);
});
