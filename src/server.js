const http = require('http');
const fs = require('fs');
const path = require('path');
const { createCache } = require('./cache.js');
const { readMcpServers } = require('./sources/mcp.js');
const { readSkills } = require('./sources/skills.js');
const { readMemory } = require('./sources/memory.js');
const { readTasks } = require('./sources/tasks.js');
const { readSessionStats } = require('./sources/sessionStats.js');
const { readInstall } = require('./sources/install.js');
const { moveSessionToTrash } = require('./actions/deleteSession.js');
const { readMemoryFile } = require('./sources/memoryFile.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer({ config, pricing }) {
  const cache = createCache({ projectsDir: config.PROJECTS_DIR, pricing, config });
  let snapshot = cache.refresh();
  const timer = setInterval(() => { snapshot = cache.refresh(); }, config.POLL_MS);
  if (timer.unref) timer.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'DELETE' && p.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(p.slice('/api/sessions/'.length));
      const entry = snapshot.files[id];
      if (!entry) return sendJson(res, 404, { error: 'not found' });
      try {
        const { trashedTo } = moveSessionToTrash({
          file: entry.file,
          projectsDir: config.PROJECTS_DIR,
          trashDir: config.TRASH_DIR,
          project: entry.project,
          sessionId: id,
          now: Date.now(),
        });
        snapshot = cache.refresh();
        return sendJson(res, 200, { ok: true, trashedTo });
      } catch (e) {
        if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 500, { error: e.message });
      }
    }

    if (p === '/api/overview') return sendJson(res, 200, snapshot.overview);
    if (p === '/api/sessions') {
      const project = url.searchParams.get('project');
      const cards = project ? snapshot.cards.filter(c => c.project === project) : snapshot.cards;
      return sendJson(res, 200, cards);
    }
    if (p.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(p.slice('/api/sessions/'.length));
      const card = snapshot.cards.find(c => c.sessionId === id);
      if (!card) return sendJson(res, 404, { error: 'not found' });
      const stats = readSessionStats(config.SESSION_STATS)[id] || null;
      return sendJson(res, 200, { ...card, toolCounts: stats ? stats.tool_counts : {} });
    }
    if (p === '/api/mcp') return sendJson(res, 200, readMcpServers(config.CLAUDE_JSON, config.MCP_AUTH_CACHE));
    if (p === '/api/skills') return sendJson(res, 200, readSkills(config.INSTALLED_PLUGINS, config.SETTINGS));
    if (p === '/api/memory') return sendJson(res, 200, readMemory(config.PROJECTS_DIR));
    if (p === '/api/memory/file') {
      const project = url.searchParams.get('project');
      const name = url.searchParams.get('name');
      if (!project || !name) return sendJson(res, 400, { error: 'project and name required' });
      try {
        const { content } = readMemoryFile({ projectsDir: config.PROJECTS_DIR, project, name });
        return sendJson(res, 200, { project, name, content });
      } catch (e) {
        if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 500, { error: e.message });
      }
    }
    if (p === '/api/tasks') return sendJson(res, 200, readTasks(config.TASKS_DIR));
    if (p === '/api/install') return sendJson(res, 200, readInstall({
      claudeJson: config.CLAUDE_JSON,
      installedPlugins: config.INSTALLED_PLUGINS,
      marketplaces: config.MARKETPLACES,
      lastUpdate: config.LAST_UPDATE_RESULT,
      settings: config.SETTINGS,
      projectsDir: config.PROJECTS_DIR,
    }));
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });

    return serveStatic(res, p);
  });

  return { server, stop: () => clearInterval(timer) };
}

if (require.main === module) {
  const config = require('./config.js');
  const pricing = require('./pricing.json');
  const { server } = createServer({ config, pricing });
  server.listen(config.PORT, '127.0.0.1', () => {
    console.log(`Claude Dashboard → http://localhost:${config.PORT}`);
  });
}

module.exports = { createServer };
