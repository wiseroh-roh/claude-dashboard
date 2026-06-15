const { listTranscripts, parseTranscript } = require('./sources/sessions.js');
const { buildSessionCard, buildOverview } = require('./metrics/aggregate.js');

function createCache({ projectsDir, pricing, config }) {
  const parsed = new Map(); // file -> { mtimeMs, summary }

  function refresh(now = Date.now()) {
    const list = listTranscripts(projectsDir);
    const seen = new Set();
    for (const { file, project, mtimeMs } of list) {
      seen.add(file);
      const cached = parsed.get(file);
      if (!cached || cached.mtimeMs !== mtimeMs) {
        parsed.set(file, { mtimeMs, summary: parseTranscript(file, project) });
      }
    }
    for (const file of [...parsed.keys()]) {
      if (!seen.has(file)) parsed.delete(file);
    }
    const cards = [...parsed.values()]
      .map(v => buildSessionCard(v.summary, { pricing, now, config }))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    const files = {};
    for (const [file, v] of parsed) {
      files[v.summary.sessionId] = { file, project: v.summary.project };
    }
    return { cards, overview: buildOverview(cards), files };
  }

  return { refresh };
}

module.exports = { createCache };
