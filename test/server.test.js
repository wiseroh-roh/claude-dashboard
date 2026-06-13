const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createServer } = require('../src/server.js');

const FIX = path.join(__dirname, 'fixtures');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    require('http').get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('serves overview, sessions, mcp, skills, memory endpoints', async () => {
  const config = {
    PROJECTS_DIR: path.join(FIX, 'projects'),
    SESSION_STATS: path.join(FIX, '.session-stats.json'),
    CLAUDE_JSON: path.join(FIX, 'claude.json'),
    MCP_AUTH_CACHE: path.join(FIX, 'mcp-needs-auth-cache.json'),
    INSTALLED_PLUGINS: path.join(FIX, 'plugins', 'installed_plugins.json'),
    SETTINGS: path.join(FIX, 'settings.json'),
    TASKS_DIR: path.join(FIX, 'tasks'),
    RUNNING_THRESHOLD_MS: 60_000,
    IDLE_THRESHOLD_MS: 1_800_000,
    POLL_MS: 999_999, // effectively disable auto-poll during test
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const ov = await get(port, '/api/overview');
    assert.strictEqual(ov.status, 200);
    assert.ok(JSON.parse(ov.body).totalSessions >= 1);

    const sessions = await get(port, '/api/sessions');
    assert.strictEqual(sessions.status, 200);
    assert.ok(Array.isArray(JSON.parse(sessions.body)));

    const mcp = await get(port, '/api/mcp');
    assert.ok(Array.isArray(JSON.parse(mcp.body)));

    const skills = await get(port, '/api/skills');
    assert.ok(Array.isArray(JSON.parse(skills.body)));

    const memory = await get(port, '/api/memory');
    assert.ok(Array.isArray(JSON.parse(memory.body)));

    const missing = await get(port, '/api/nope');
    assert.strictEqual(missing.status, 404);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
