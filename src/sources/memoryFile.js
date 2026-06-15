const fs = require('fs');
const path = require('path');

// Read a memory file's raw content. Pure file-system helper — knows nothing
// about HTTP. Throws Error with .code 'EOUTSIDE' (name has separators/`..` or
// the resolved path escapes projectsDir) or 'ENOENT' (file missing).
function readMemoryFile({ projectsDir, project, name }) {
  if (typeof name !== 'string' || name === '' || /[\\/]/.test(name) || name.includes('..')) {
    const err = new Error('invalid memory file name');
    err.code = 'EOUTSIDE';
    throw err;
  }
  const resolved = path.resolve(path.join(projectsDir, project, 'memory', name));
  const base = path.resolve(projectsDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    const err = new Error('memory file is outside projectsDir');
    err.code = 'EOUTSIDE';
    throw err;
  }
  if (!fs.existsSync(resolved)) {
    const err = new Error('memory file not found');
    err.code = 'ENOENT';
    throw err;
  }
  return { content: fs.readFileSync(resolved, 'utf8') };
}

module.exports = { readMemoryFile };
