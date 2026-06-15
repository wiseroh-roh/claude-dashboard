const fs = require('fs');
const path = require('path');

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '-');
}

// Move a session transcript into the trash dir. Pure file-system helper —
// knows nothing about HTTP. Throws Error with .code 'EOUTSIDE' (path escapes
// projectsDir) or 'ENOENT' (file missing) for the caller to map to a status.
function moveSessionToTrash({ file, projectsDir, trashDir, project, sessionId, now }) {
  const resolved = path.resolve(file);
  const base = path.resolve(projectsDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    const err = new Error('session file is outside projectsDir');
    err.code = 'EOUTSIDE';
    throw err;
  }
  if (!fs.existsSync(resolved)) {
    const err = new Error('session file not found');
    err.code = 'ENOENT';
    throw err;
  }
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${sanitize(project)}__${sanitize(sessionId)}__${now}.jsonl`);
  fs.renameSync(resolved, dest);
  return { trashedTo: dest };
}

module.exports = { moveSessionToTrash, sanitize };
