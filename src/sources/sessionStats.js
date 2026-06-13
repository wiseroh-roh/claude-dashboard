const fs = require('fs');

function readSessionStats(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  try {
    const obj = JSON.parse(raw);
    return (obj && obj.sessions) || {};
  } catch { return {}; }
}

module.exports = { readSessionStats };
