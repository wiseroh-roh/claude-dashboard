const fs = require('fs');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readSkills(installedPluginsFile, settingsFile) {
  const installed = readJsonSafe(installedPluginsFile);
  if (!installed || !installed.plugins) return [];
  const settings = readJsonSafe(settingsFile) || {};
  const enabled = settings.enabledPlugins || {};

  return Object.entries(installed.plugins).map(([name, entries]) => {
    const entry = Array.isArray(entries) ? entries[0] || {} : {};
    return {
      name,
      version: entry.version || null,
      scope: entry.scope || null,
      installedAt: entry.installedAt || null,
      enabled: enabled[name] === true,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { readSkills };
