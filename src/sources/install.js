const fs = require('fs');
const { listTranscripts } = require('./sessions.js');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// The Claude Code version currently writing sessions = the `version` field on
// the newest transcript line. Falls back to null if no transcript is found.
function currentVersion(projectsDir) {
  const list = listTranscripts(projectsDir);
  if (!list.length) return null;
  list.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let text = '';
  try { text = fs.readFileSync(list[0].file, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.version) return o.version; } catch { /* skip */ }
  }
  return null;
}

function readInstall({ claudeJson, installedPlugins, marketplaces, lastUpdate, settings, projectsDir }) {
  const cj = readJsonSafe(claudeJson) || {};
  const ip = readJsonSafe(installedPlugins) || {};
  const mk = readJsonSafe(marketplaces) || {};
  const lu = readJsonSafe(lastUpdate);
  const enabled = (readJsonSafe(settings) || {}).enabledPlugins || {};

  const plugins = Object.entries(ip.plugins || {}).map(([name, arr]) => {
    const e = Array.isArray(arr) ? arr[0] || {} : {};
    return {
      name,
      version: e.version || null,
      scope: e.scope || null,
      installedAt: e.installedAt || null,
      lastUpdated: e.lastUpdated || null,
      enabled: enabled[name] === true,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const marketplaceList = Object.entries(mk).map(([name, v]) => {
    const src = (v && v.source) || {};
    return { name, source: src.repo || src.url || src.source || null, lastUpdated: (v && v.lastUpdated) || null };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const update = lu ? {
    outcome: lu.outcome || lu.status || null,
    status: lu.status || null,
    versionFrom: lu.version_from || null,
    versionTo: lu.version_to || null,
    errorCode: lu.error_code || null,
    timestamp: lu.timestamp || null,
  } : null;

  const claudeCode = {
    version: currentVersion(projectsDir) || (update && update.versionFrom) || null,
    installMethod: cj.installMethod || null,
    numStartups: cj.numStartups || null,
    firstStartTime: cj.firstStartTime || null,
    update,
  };

  return { claudeCode, plugins, marketplaces: marketplaceList };
}

module.exports = { readInstall };
