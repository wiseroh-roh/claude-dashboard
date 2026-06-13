const fs = require('fs');
const path = require('path');

function readTasks(tasksDir) {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(tasksDir); } catch { return out; }
  for (const sessionId of dirs) {
    const dir = path.join(tasksDir, sessionId);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => !f.startsWith('.')); } catch { /* ignore */ }
    out.push({ sessionId, fileCount: files.length, mtimeMs: st.mtimeMs });
  }
  return out;
}

module.exports = { readTasks };
