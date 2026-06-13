const fs = require('fs');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMcpServers(claudeJsonPath, authCachePath) {
  const claude = readJsonSafe(claudeJsonPath) || {};
  const authCache = readJsonSafe(authCachePath) || {};

  const map = new Map(); // name -> { name, configured, needsAuth }

  // Global configured servers (defensive: key may be absent)
  for (const name of Object.keys(claude.mcpServers || {})) {
    map.set(name, { name, configured: true, needsAuth: false });
  }
  // Per-project configured servers, if present
  for (const proj of Object.values(claude.projects || {})) {
    for (const name of Object.keys((proj && proj.mcpServers) || {})) {
      if (!map.has(name)) map.set(name, { name, configured: true, needsAuth: false });
    }
  }
  // Servers flagged as needing auth
  for (const name of Object.keys(authCache)) {
    const existing = map.get(name) || { name, configured: false, needsAuth: false };
    existing.needsAuth = true;
    map.set(name, existing);
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { readMcpServers };
