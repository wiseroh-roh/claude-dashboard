const fs = require('fs');
const path = require('path');

function readMemory(projectsDir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(projectsDir); } catch { return out; }
  for (const p of projects) {
    const memDir = path.join(projectsDir, p, 'memory');
    let entries;
    try { entries = fs.readdirSync(memDir); } catch { continue; }
    const files = [];
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      let size = 0;
      try { size = fs.statSync(path.join(memDir, name)).size; } catch { /* ignore */ }
      files.push({ name, size });
    }
    if (files.length) {
      out.push({ project: p, files: files.sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return out;
}

module.exports = { readMemory };
