const fs = require('fs');
const path = require('path');

function parseTranscript(filePath, project) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { text = ''; }

  let sessionId = path.basename(filePath, '.jsonl');
  let model = null, firstTs = null, lastTs = null, turns = 0;
  // Track only the MOST RECENT tool_result's error state so a transient error
  // that was later recovered does not flag the whole session as failed.
  let lastToolError = false;
  let lastUserTs = null;
  const tokens = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  const latencies = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts != null && !Number.isNaN(ts)) {
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    if (o.sessionId) sessionId = o.sessionId;

    const msg = o.message;
    const role = msg && msg.role;
    // tool_result items live in the content array of user-role messages.
    if (msg && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item && item.type === 'tool_result') lastToolError = item.is_error === true;
      }
    }
    if (role === 'user' && ts != null) lastUserTs = ts;
    if (role === 'assistant' && msg) {
      turns++;
      if (msg.model) model = msg.model;
      const u = msg.usage;
      if (u) {
        tokens.input += u.input_tokens || 0;
        tokens.output += u.output_tokens || 0;
        tokens.cacheCreate += u.cache_creation_input_tokens || 0;
        tokens.cacheRead += u.cache_read_input_tokens || 0;
      }
      if (ts != null && lastUserTs != null) {
        latencies.push(ts - lastUserTs);
        lastUserTs = null;
      }
    }
  }

  const avgResponseMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  return { sessionId, project, model, turns, tokens, firstTs, lastTs, avgResponseMs, hasError: lastToolError };
}

function listTranscripts(projectsDir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(projectsDir); } catch { return out; }
  for (const p of projects) {
    const dir = path.join(projectsDir, p);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      out.push({ file, project: p, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

module.exports = { parseTranscript, listTranscripts };
