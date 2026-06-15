const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createServer } = require('../src/server.js');

const FIX = path.join(__dirname, 'fixtures');
const fs = require('node:fs');
const os = require('node:os');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    require('http').get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function del_(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = require('http').request(
      { host: '127.0.0.1', port, path: urlPath, method: 'DELETE' },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
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

test('DELETE /api/sessions/:id moves the session to trash and drops it from listing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-srv-'));
  fs.cpSync(path.join(FIX, 'projects'), path.join(root, 'projects'), { recursive: true });
  const trashDir = path.join(root, '.trash', 'sessions');
  const config = {
    PROJECTS_DIR: path.join(root, 'projects'),
    SESSION_STATS: path.join(FIX, '.session-stats.json'),
    CLAUDE_JSON: path.join(FIX, 'claude.json'),
    MCP_AUTH_CACHE: path.join(FIX, 'mcp-needs-auth-cache.json'),
    INSTALLED_PLUGINS: path.join(FIX, 'plugins', 'installed_plugins.json'),
    SETTINGS: path.join(FIX, 'settings.json'),
    TASKS_DIR: path.join(FIX, 'tasks'),
    TRASH_DIR: trashDir,
    RUNNING_THRESHOLD_MS: 60_000,
    IDLE_THRESHOLD_MS: 1_800_000,
    POLL_MS: 999_999,
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const before = JSON.parse((await get(port, '/api/sessions')).body);
    assert.ok(before.some(c => c.sessionId === 'sess1'), 'sess1 present before delete');

    const res = await del_(port, '/api/sessions/sess1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(JSON.parse(res.body).ok, true);

    const trashed = fs.readdirSync(trashDir);
    assert.ok(trashed.some(f => f.startsWith('proj-a__sess1__') && f.endsWith('.jsonl')), 'file moved to trash');

    const after = JSON.parse((await get(port, '/api/sessions')).body);
    assert.ok(!after.some(c => c.sessionId === 'sess1'), 'sess1 gone after delete');

    const miss = await del_(port, '/api/sessions/does-not-exist');
    assert.strictEqual(miss.status, 404);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});

test('GET /api/memory/file returns content, 400 on traversal, 404 on missing', async () => {
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
    POLL_MS: 999_999,
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const ok = await get(port, '/api/memory/file?project=proj-a&name=some-fact.md');
    assert.strictEqual(ok.status, 200);
    const body = JSON.parse(ok.body);
    assert.strictEqual(body.name, 'some-fact.md');
    assert.ok(body.content.includes('body'));
    assert.ok(body.content.includes('a test fact'));

    const bad = await get(port, '/api/memory/file?project=proj-a&name=' + encodeURIComponent('../../etc'));
    assert.strictEqual(bad.status, 400);

    const miss = await get(port, '/api/memory/file?project=proj-a&name=nope.md');
    assert.strictEqual(miss.status, 404);

    const noargs = await get(port, '/api/memory/file');
    assert.strictEqual(noargs.status, 400);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
