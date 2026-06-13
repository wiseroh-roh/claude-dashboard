const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./frontmatter.js');

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
      const full = path.join(memDir, name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch { /* ignore */ }
      let text = '';
      try { text = fs.readFileSync(full, 'utf8'); } catch { /* ignore */ }
      const fm = parseFrontmatter(text);
      files.push({
        name,
        size,
        description: fm.description || (name === 'MEMORY.md' ? '메모리 인덱스' : ''),
        type: fm.type || null,
      });
    }
    if (files.length) {
      out.push({ project: p, files: files.sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return out;
}

module.exports = { readMemory };
