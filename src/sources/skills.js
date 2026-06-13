const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./frontmatter.js');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Read the skills a plugin ships: each lives at <installPath>/skills/<dir>/SKILL.md
// with `name`/`description` frontmatter.
function readPluginSkills(installPath) {
  if (!installPath) return [];
  const skillsDir = path.join(installPath, 'skills');
  let dirs;
  try { dirs = fs.readdirSync(skillsDir, { withFileTypes: true }); } catch { return []; }
  const skills = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let text;
    try { text = fs.readFileSync(path.join(skillsDir, d.name, 'SKILL.md'), 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(text);
    skills.push({ name: fm.name || d.name, description: fm.description || '' });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
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
      skills: readPluginSkills(entry.installPath),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { readSkills };
