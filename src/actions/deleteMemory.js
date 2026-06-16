const fs = require('fs');
const path = require('path');

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '-');
}

// Move a memory file into the trash dir. Pure file-system helper — knows
// nothing about HTTP. Throws Error with .code 'EOUTSIDE' (name has
// separators/`..` or the resolved path escapes projectsDir) or 'ENOENT'.
function moveMemoryToTrash({ projectsDir, trashDir, project, name, now }) {
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
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${sanitize(project)}__${now}__${sanitize(name)}`);
  fs.renameSync(resolved, dest);
  return { trashedTo: dest };
}

module.exports = { moveMemoryToTrash };
