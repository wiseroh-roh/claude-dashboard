const fs = require('fs');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function get(map, name) {
  if (!map.has(name)) {
    map.set(name, { name, configured: false, needsAuth: false, everConnected: false });
  }
  return map.get(name);
}

function readMcpServers(claudeJsonPath, authCachePath) {
  const claude = readJsonSafe(claudeJsonPath) || {};
  const authCache = readJsonSafe(authCachePath) || {};

  const map = new Map(); // name -> { name, configured, needsAuth, everConnected, status }

  // Locally configured servers (.claude.json mcpServers — global and per-project)
  for (const name of Object.keys(claude.mcpServers || {})) get(map, name).configured = true;
  for (const proj of Object.values(claude.projects || {})) {
    for (const name of Object.keys((proj && proj.mcpServers) || {})) get(map, name).configured = true;
  }
  // claude.ai servers that have actually connected = installed and usable
  for (const name of (Array.isArray(claude.claudeAiMcpEverConnected) ? claude.claudeAiMcpEverConnected : [])) {
    get(map, name).everConnected = true;
  }
  // Servers flagged as needing authentication before they can be used
  for (const name of Object.keys(authCache)) get(map, name).needsAuth = true;

  // Derive a single status: needs-auth blocks use; otherwise connected/configured
  // means available; bare entries fall back to 'configured'.
  for (const s of map.values()) {
    s.status = s.needsAuth ? 'needs_auth'
      : (s.everConnected || s.configured) ? 'connected'
      : 'configured';
  }

  const order = { connected: 0, needs_auth: 1, configured: 2 };
  return [...map.values()].sort(
    (a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name),
  );
}

module.exports = { readMcpServers };
