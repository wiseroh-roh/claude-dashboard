# Claude Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local read-only web dashboard that reads `~/.claude` and visualizes Claude Code state (sessions, MCP, skills, memory, tasks).

**Architecture:** A Node backend (zero runtime dependencies — Node built-ins only) reads `~/.claude` files, parses session transcripts incrementally (re-parsing only files whose mtime changed), aggregates KPIs/cost/status, and exposes JSON over HTTP. A static vanilla-JS frontend polls those endpoints every few seconds and renders a KPI bar + tabbed card grid (Sessions / MCP / Skills / Memory). Chart.js is loaded from CDN for charts.

**Tech Stack:** Node (`http`, `fs`, `path`, `os`), `node:test` + `node:assert` for tests (no test framework install), vanilla HTML/CSS/JS, Chart.js via CDN.

---

## Conventions

- **All paths are configurable via `CLAUDE_DIR` env var** so tests point at fixture directories instead of the real `~/.claude`.
- **Token units:** pricing is expressed as USD per **million** tokens.
- **Timestamps:** all internal timestamps are milliseconds since epoch (`Date.parse(...)` / `mtimeMs` / `started_at*1000`).
- **Test command:** `node --test` (run from project root; discovers `test/**/*.test.js`).
- **Commit after every task.**

## Canonical Data Shapes (referenced by every task)

```js
// SessionSummary — produced by sources/sessions.js parseTranscript()
{
  sessionId: string,
  project: string,            // encoded project dir name
  model: string | null,       // e.g. "claude-opus-4-8"
  turns: number,              // count of assistant messages
  tokens: { input, output, cacheCreate, cacheRead },  // numbers
  firstTs: number | null,     // ms epoch
  lastTs: number | null,      // ms epoch
  avgResponseMs: number | null,
  hasError: boolean
}

// SessionCard — produced by metrics/aggregate.js buildSessionCard()
// = SessionSummary plus:
{ status: 'running'|'waiting'|'idle'|'error', costUsd: number }

// Overview — produced by metrics/aggregate.js buildOverview()
{
  totalSessions, runningSessions, totalTurns,
  totalInputTokens, totalOutputTokens,
  avgResponseMs: number | null, estimatedCostUsd: number
}
```

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | scripts (`test`, `start`), metadata, `"type":"commonjs"` |
| `src/config.js` | resolve `~/.claude` paths, port, poll interval, status thresholds |
| `src/pricing.json` | model → per-million-token USD rates (user-editable) |
| `src/sources/sessions.js` | `listTranscripts(dir)`, `parseTranscript(file, project)` |
| `src/sources/sessionStats.js` | `readSessionStats(file)` |
| `src/sources/mcp.js` | `readMcpServers(claudeJson, authCache)` |
| `src/sources/skills.js` | `readSkills(installedPluginsFile, settingsFile)` |
| `src/sources/memory.js` | `readMemory(projectsDir)` |
| `src/sources/tasks.js` | `readTasks(tasksDir)` |
| `src/metrics/cost.js` | `computeCost(tokens, model, pricing)` |
| `src/metrics/status.js` | `computeStatus(summary, now, config)` |
| `src/metrics/aggregate.js` | `buildSessionCard()`, `buildOverview()` |
| `src/cache.js` | `createCache(...)` → incremental mtime-based refresh |
| `src/server.js` | HTTP server, API routes, static files, poll loop |
| `public/index.html` | KPI bar + tabs markup, Chart.js CDN |
| `public/styles.css` | dashboard styling |
| `public/app.js` | polling, rendering, tab switching, detail modal |
| `test/*.test.js` | unit + endpoint tests |
| `test/fixtures/` | sample `~/.claude` tree used by tests |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/pricing.json`
- Test: `test/config.test.js`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "claude-dashboard",
  "version": "0.1.0",
  "description": "Local read-only dashboard for Claude Code state",
  "type": "commonjs",
  "scripts": {
    "test": "node --test",
    "start": "node src/server.js"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Write the failing test**

`test/config.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

test('config resolves paths under CLAUDE_DIR override', () => {
  process.env.CLAUDE_DIR = path.join('/tmp', 'fake-claude');
  delete require.cache[require.resolve('../src/config.js')];
  const cfg = require('../src/config.js');
  assert.strictEqual(cfg.CLAUDE_DIR, path.join('/tmp', 'fake-claude'));
  assert.strictEqual(cfg.PROJECTS_DIR, path.join('/tmp', 'fake-claude', 'projects'));
  assert.strictEqual(cfg.SESSION_STATS, path.join('/tmp', 'fake-claude', '.session-stats.json'));
  assert.ok(cfg.RUNNING_THRESHOLD_MS > 0);
  assert.ok(cfg.IDLE_THRESHOLD_MS > cfg.RUNNING_THRESHOLD_MS);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 4: Write `src/config.js`**

```js
const os = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR: path.join(CLAUDE_DIR, 'projects'),
  SESSION_STATS: path.join(CLAUDE_DIR, '.session-stats.json'),
  CLAUDE_JSON: process.env.CLAUDE_JSON || path.join(os.homedir(), '.claude.json'),
  MCP_AUTH_CACHE: path.join(CLAUDE_DIR, 'mcp-needs-auth-cache.json'),
  INSTALLED_PLUGINS: path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'),
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  TASKS_DIR: path.join(CLAUDE_DIR, 'tasks'),
  PORT: Number(process.env.PORT) || 7878,
  POLL_MS: Number(process.env.POLL_MS) || 5000,
  RUNNING_THRESHOLD_MS: 60 * 1000,
  IDLE_THRESHOLD_MS: 30 * 60 * 1000,
};
```

- [ ] **Step 5: Write `src/pricing.json`** (USD per million tokens; user-editable estimates)

```json
{
  "default":            { "input": 3,  "output": 15, "cacheWrite": 3.75,  "cacheRead": 0.3 },
  "claude-opus-4-8":    { "input": 15, "output": 75, "cacheWrite": 18.75, "cacheRead": 1.5 },
  "claude-sonnet-4-6":  { "input": 3,  "output": 15, "cacheWrite": 3.75,  "cacheRead": 0.3 },
  "claude-haiku-4-5":   { "input": 1,  "output": 5,  "cacheWrite": 1.25,  "cacheRead": 0.1 }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json src/config.js src/pricing.json test/config.test.js
git commit -m "feat: project scaffold (config, pricing, test setup)"
```

---

## Task 2: Cost computation (`metrics/cost.js`)

**Files:**
- Create: `src/metrics/cost.js`
- Test: `test/cost.test.js`

- [ ] **Step 1: Write the failing test**

`test/cost.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeCost } = require('../src/metrics/cost.js');

const pricing = {
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

test('computes cost per million tokens for known model', () => {
  const tokens = { input: 1_000_000, output: 1_000_000, cacheCreate: 0, cacheRead: 0 };
  // 1M input * $15 + 1M output * $75 = 90
  assert.strictEqual(computeCost(tokens, 'claude-opus-4-8', pricing), 90);
});

test('includes cache tokens', () => {
  const tokens = { input: 0, output: 0, cacheCreate: 1_000_000, cacheRead: 2_000_000 };
  // 1M*18.75 + 2M*1.5 = 21.75
  assert.strictEqual(computeCost(tokens, 'claude-opus-4-8', pricing), 21.75);
});

test('falls back to default pricing for unknown model', () => {
  const tokens = { input: 1_000_000, output: 0, cacheCreate: 0, cacheRead: 0 };
  assert.strictEqual(computeCost(tokens, 'mystery-model', pricing), 3);
});

test('handles null model and missing token fields', () => {
  assert.strictEqual(computeCost({ input: 1_000_000 }, null, pricing), 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cost.test.js`
Expected: FAIL — `Cannot find module '../src/metrics/cost.js'`

- [ ] **Step 3: Write `src/metrics/cost.js`**

```js
function computeCost(tokens = {}, model, pricing) {
  const rates = (model && pricing[model]) || pricing.default;
  const input = (tokens.input || 0) / 1e6 * rates.input;
  const output = (tokens.output || 0) / 1e6 * rates.output;
  const cacheWrite = (tokens.cacheCreate || 0) / 1e6 * rates.cacheWrite;
  const cacheRead = (tokens.cacheRead || 0) / 1e6 * rates.cacheRead;
  return input + output + cacheWrite + cacheRead;
}

module.exports = { computeCost };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cost.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/metrics/cost.js test/cost.test.js
git commit -m "feat: token cost computation"
```

---

## Task 3: Status heuristic (`metrics/status.js`)

**Files:**
- Create: `src/metrics/status.js`
- Test: `test/status.test.js`

- [ ] **Step 1: Write the failing test**

`test/status.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeStatus } = require('../src/metrics/status.js');

const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const now = 1_000_000_000_000;

test('error wins regardless of recency', () => {
  assert.strictEqual(computeStatus({ lastTs: now, hasError: true }, now, config), 'error');
});

test('running when activity within running threshold', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 30_000, hasError: false }, now, config), 'running');
});

test('waiting when between running and idle thresholds', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 300_000, hasError: false }, now, config), 'waiting');
});

test('idle when older than idle threshold', () => {
  assert.strictEqual(computeStatus({ lastTs: now - 3_600_000, hasError: false }, now, config), 'idle');
});

test('idle when lastTs is null', () => {
  assert.strictEqual(computeStatus({ lastTs: null, hasError: false }, now, config), 'idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/status.test.js`
Expected: FAIL — `Cannot find module '../src/metrics/status.js'`

- [ ] **Step 3: Write `src/metrics/status.js`**

```js
// Recency-based refinement of the spec heuristic. Error always wins; otherwise
// classify by how long ago the session last had activity.
function computeStatus(summary, now, config) {
  if (summary.hasError) return 'error';
  if (summary.lastTs == null) return 'idle';
  const age = now - summary.lastTs;
  if (age <= config.RUNNING_THRESHOLD_MS) return 'running';
  if (age <= config.IDLE_THRESHOLD_MS) return 'waiting';
  return 'idle';
}

module.exports = { computeStatus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/status.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/metrics/status.js test/status.test.js
git commit -m "feat: session status heuristic"
```

---

## Task 4: Transcript parsing (`sources/sessions.js`)

**Files:**
- Create: `src/sources/sessions.js`
- Create: `test/fixtures/projects/proj-a/sess1.jsonl`
- Test: `test/sessions.test.js`

- [ ] **Step 1: Create the fixture transcript**

`test/fixtures/projects/proj-a/sess1.jsonl` (one JSON object per line — keep exactly these 5 lines):

```jsonl
{"type":"user","timestamp":"2026-06-13T14:30:00.000Z","sessionId":"sess1","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-06-13T14:30:02.000Z","sessionId":"sess1","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":20}}}
{"type":"user","timestamp":"2026-06-13T14:31:00.000Z","sessionId":"sess1","message":{"role":"user","content":"more"}}
not valid json — must be skipped
{"type":"assistant","timestamp":"2026-06-13T14:31:04.000Z","sessionId":"sess1","message":{"role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":200,"output_tokens":80,"cache_creation_input_tokens":0,"cache_read_input_tokens":5}}}
```

- [ ] **Step 2: Write the failing test**

`test/sessions.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { parseTranscript, listTranscripts } = require('../src/sources/sessions.js');

const FIX = path.join(__dirname, 'fixtures', 'projects');

test('parseTranscript aggregates tokens, turns, latency and skips bad lines', () => {
  const s = parseTranscript(path.join(FIX, 'proj-a', 'sess1.jsonl'), 'proj-a');
  assert.strictEqual(s.sessionId, 'sess1');
  assert.strictEqual(s.project, 'proj-a');
  assert.strictEqual(s.model, 'claude-opus-4-8');
  assert.strictEqual(s.turns, 2);
  assert.deepStrictEqual(s.tokens, { input: 300, output: 130, cacheCreate: 10, cacheRead: 25 });
  assert.strictEqual(s.hasError, false);
  // latencies: 2s and 4s -> avg 3000ms
  assert.strictEqual(s.avgResponseMs, 3000);
  assert.strictEqual(s.firstTs, Date.parse('2026-06-13T14:30:00.000Z'));
  assert.strictEqual(s.lastTs, Date.parse('2026-06-13T14:31:04.000Z'));
});

test('listTranscripts finds jsonl files with project and mtime', () => {
  const list = listTranscripts(FIX);
  const found = list.find(x => x.file.endsWith('sess1.jsonl'));
  assert.ok(found);
  assert.strictEqual(found.project, 'proj-a');
  assert.ok(typeof found.mtimeMs === 'number');
});

test('listTranscripts returns [] for missing dir', () => {
  assert.deepStrictEqual(listTranscripts('/no/such/dir'), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/sessions.test.js`
Expected: FAIL — `Cannot find module '../src/sources/sessions.js'`

- [ ] **Step 4: Write `src/sources/sessions.js`**

```js
const fs = require('fs');
const path = require('path');

function parseTranscript(filePath, project) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { text = ''; }

  let sessionId = path.basename(filePath, '.jsonl');
  let model = null, firstTs = null, lastTs = null, turns = 0, hasError = false;
  let lastUserTs = null;
  const tokens = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  const latencies = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (line.includes('"is_error":true')) hasError = true;
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

  return { sessionId, project, model, turns, tokens, firstTs, lastTs, avgResponseMs, hasError };
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/sessions.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/sessions.js test/sessions.test.js test/fixtures/projects/proj-a/sess1.jsonl
git commit -m "feat: transcript parser (tokens, turns, latency, errors)"
```

---

## Task 5: Aggregation (`metrics/aggregate.js`)

**Files:**
- Create: `src/metrics/aggregate.js`
- Test: `test/aggregate.test.js`

- [ ] **Step 1: Write the failing test**

`test/aggregate.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSessionCard, buildOverview } = require('../src/metrics/aggregate.js');

const pricing = {
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};
const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const now = 1_000_000_000_000;

const summary = {
  sessionId: 'sess1', project: 'proj-a', model: 'claude-opus-4-8',
  turns: 2, tokens: { input: 1_000_000, output: 0, cacheCreate: 0, cacheRead: 0 },
  firstTs: now - 120_000, lastTs: now - 30_000, avgResponseMs: 3000, hasError: false,
};

test('buildSessionCard adds status and cost', () => {
  const card = buildSessionCard(summary, { pricing, now, config });
  assert.strictEqual(card.status, 'running');
  assert.strictEqual(card.costUsd, 15);
  assert.strictEqual(card.sessionId, 'sess1');
  assert.strictEqual(card.turns, 2);
});

test('buildOverview totals across cards', () => {
  const cards = [
    buildSessionCard(summary, { pricing, now, config }),
    buildSessionCard({ ...summary, sessionId: 's2', lastTs: now - 3_600_000, avgResponseMs: 1000,
      tokens: { input: 0, output: 1_000_000, cacheCreate: 0, cacheRead: 0 } }, { pricing, now, config }),
  ];
  const ov = buildOverview(cards);
  assert.strictEqual(ov.totalSessions, 2);
  assert.strictEqual(ov.runningSessions, 1);
  assert.strictEqual(ov.totalTurns, 4);
  assert.strictEqual(ov.totalInputTokens, 1_000_000);
  assert.strictEqual(ov.totalOutputTokens, 1_000_000);
  assert.strictEqual(ov.avgResponseMs, 2000); // (3000+1000)/2
  assert.strictEqual(ov.estimatedCostUsd, 90); // 15 + 75
});

test('buildOverview avgResponseMs is null when no latencies', () => {
  const cards = [buildSessionCard({ ...summary, avgResponseMs: null }, { pricing, now, config })];
  assert.strictEqual(cards[0].avgResponseMs, null);
  assert.strictEqual(buildOverview(cards).avgResponseMs, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aggregate.test.js`
Expected: FAIL — `Cannot find module '../src/metrics/aggregate.js'`

- [ ] **Step 3: Write `src/metrics/aggregate.js`**

```js
const { computeCost } = require('./cost.js');
const { computeStatus } = require('./status.js');

function buildSessionCard(summary, { pricing, now, config }) {
  return {
    ...summary,
    status: computeStatus(summary, now, config),
    costUsd: computeCost(summary.tokens, summary.model, pricing),
  };
}

function buildOverview(cards) {
  const latencies = cards.map(c => c.avgResponseMs).filter(v => typeof v === 'number');
  const avgResponseMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  return {
    totalSessions: cards.length,
    runningSessions: cards.filter(c => c.status === 'running').length,
    totalTurns: cards.reduce((a, c) => a + (c.turns || 0), 0),
    totalInputTokens: cards.reduce((a, c) => a + (c.tokens.input || 0), 0),
    totalOutputTokens: cards.reduce((a, c) => a + (c.tokens.output || 0), 0),
    avgResponseMs,
    estimatedCostUsd: cards.reduce((a, c) => a + (c.costUsd || 0), 0),
  };
}

module.exports = { buildSessionCard, buildOverview };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aggregate.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/metrics/aggregate.js test/aggregate.test.js
git commit -m "feat: session card + overview aggregation"
```

---

## Task 6: Session stats source (`sources/sessionStats.js`)

**Files:**
- Create: `src/sources/sessionStats.js`
- Create: `test/fixtures/.session-stats.json`
- Test: `test/sessionStats.test.js`

- [ ] **Step 1: Create the fixture**

`test/fixtures/.session-stats.json`:

```json
{
  "sessions": {
    "sess1": {
      "tool_counts": { "Read": 10, "Bash": 5 },
      "last_tool": "Read",
      "total_calls": 15,
      "started_at": 1780411275,
      "updated_at": 1780416881
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/sessionStats.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readSessionStats } = require('../src/sources/sessionStats.js');

test('reads session stats map', () => {
  const stats = readSessionStats(path.join(__dirname, 'fixtures', '.session-stats.json'));
  assert.strictEqual(stats.sess1.total_calls, 15);
  assert.deepStrictEqual(stats.sess1.tool_counts, { Read: 10, Bash: 5 });
});

test('returns {} for missing file', () => {
  assert.deepStrictEqual(readSessionStats('/no/such/file.json'), {});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/sessionStats.test.js`
Expected: FAIL — `Cannot find module '../src/sources/sessionStats.js'`

- [ ] **Step 4: Write `src/sources/sessionStats.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/sessionStats.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/sessionStats.js test/sessionStats.test.js test/fixtures/.session-stats.json
git commit -m "feat: session stats source"
```

---

## Task 7: MCP source (`sources/mcp.js`)

**Files:**
- Create: `src/sources/mcp.js`
- Create: `test/fixtures/claude.json`
- Create: `test/fixtures/mcp-needs-auth-cache.json`
- Test: `test/mcp.test.js`

- [ ] **Step 1: Create fixtures**

`test/fixtures/claude.json`:

```json
{ "mcpServers": { "local-fs": { "command": "node", "args": ["fs.js"] } } }
```

`test/fixtures/mcp-needs-auth-cache.json`:

```json
{ "claude.ai Slack": { "timestamp": 1781361028914, "id": "mcpsrv_x" } }
```

- [ ] **Step 2: Write the failing test**

`test/mcp.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readMcpServers } = require('../src/sources/mcp.js');

const FIX = path.join(__dirname, 'fixtures');

test('merges configured servers and auth-needing servers', () => {
  const servers = readMcpServers(
    path.join(FIX, 'claude.json'),
    path.join(FIX, 'mcp-needs-auth-cache.json'),
  );
  const byName = Object.fromEntries(servers.map(s => [s.name, s]));
  assert.strictEqual(byName['local-fs'].needsAuth, false);
  assert.strictEqual(byName['local-fs'].configured, true);
  assert.strictEqual(byName['claude.ai Slack'].needsAuth, true);
});

test('returns [] when both files missing', () => {
  assert.deepStrictEqual(readMcpServers('/no/a.json', '/no/b.json'), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/mcp.test.js`
Expected: FAIL — `Cannot find module '../src/sources/mcp.js'`

- [ ] **Step 4: Write `src/sources/mcp.js`**

```js
const fs = require('fs');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readMcpServers(claudeJsonPath, authCachePath) {
  const claude = readJsonSafe(claudeJsonPath) || {};
  const authCache = readJsonSafe(authCachePath) || {};

  const map = new Map(); // name -> { name, configured, needsAuth }

  // Global configured servers (defensive: key may be absent)
  for (const name of Object.keys(claude.mcpServers || {})) {
    map.set(name, { name, configured: true, needsAuth: false });
  }
  // Per-project configured servers, if present
  for (const proj of Object.values(claude.projects || {})) {
    for (const name of Object.keys((proj && proj.mcpServers) || {})) {
      if (!map.has(name)) map.set(name, { name, configured: true, needsAuth: false });
    }
  }
  // Servers flagged as needing auth
  for (const name of Object.keys(authCache)) {
    const existing = map.get(name) || { name, configured: false, needsAuth: false };
    existing.needsAuth = true;
    map.set(name, existing);
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { readMcpServers };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/mcp.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/mcp.js test/mcp.test.js test/fixtures/claude.json test/fixtures/mcp-needs-auth-cache.json
git commit -m "feat: MCP server source"
```

---

## Task 8: Skills source (`sources/skills.js`)

**Files:**
- Create: `src/sources/skills.js`
- Create: `test/fixtures/plugins/installed_plugins.json`
- Create: `test/fixtures/settings.json`
- Test: `test/skills.test.js`

- [ ] **Step 1: Create fixtures**

`test/fixtures/plugins/installed_plugins.json`:

```json
{
  "version": 2,
  "plugins": {
    "superpowers@superpowers-marketplace": [
      { "scope": "user", "version": "5.1.0", "installedAt": "2026-05-07T12:55:29.978Z" }
    ],
    "oh-my-claudecode@omc": [
      { "scope": "user", "version": "4.14.4", "installedAt": "2026-06-08T21:10:00.000Z" }
    ]
  }
}
```

`test/fixtures/settings.json`:

```json
{ "enabledPlugins": { "superpowers@superpowers-marketplace": true } }
```

- [ ] **Step 2: Write the failing test**

`test/skills.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readSkills } = require('../src/sources/skills.js');

const FIX = path.join(__dirname, 'fixtures');

test('lists plugins with enabled flag and version', () => {
  const plugins = readSkills(
    path.join(FIX, 'plugins', 'installed_plugins.json'),
    path.join(FIX, 'settings.json'),
  );
  const byName = Object.fromEntries(plugins.map(p => [p.name, p]));
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].enabled, true);
  assert.strictEqual(byName['superpowers@superpowers-marketplace'].version, '5.1.0');
  assert.strictEqual(byName['oh-my-claudecode@omc'].enabled, false);
});

test('returns [] when installed file missing', () => {
  assert.deepStrictEqual(readSkills('/no/a.json', '/no/b.json'), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/skills.test.js`
Expected: FAIL — `Cannot find module '../src/sources/skills.js'`

- [ ] **Step 4: Write `src/sources/skills.js`**

```js
const fs = require('fs');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { readSkills };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/skills.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/skills.js test/skills.test.js test/fixtures/plugins/installed_plugins.json test/fixtures/settings.json
git commit -m "feat: skills/plugins source"
```

---

## Task 9: Memory source (`sources/memory.js`)

**Files:**
- Create: `src/sources/memory.js`
- Create: `test/fixtures/projects/proj-a/memory/MEMORY.md`
- Create: `test/fixtures/projects/proj-a/memory/some-fact.md`
- Test: `test/memory.test.js`

- [ ] **Step 1: Create fixtures**

`test/fixtures/projects/proj-a/memory/MEMORY.md`:

```markdown
- [Some Fact](some-fact.md) — a hook
```

`test/fixtures/projects/proj-a/memory/some-fact.md`:

```markdown
---
name: some-fact
description: a test fact
---
body
```

- [ ] **Step 2: Write the failing test**

`test/memory.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readMemory } = require('../src/sources/memory.js');

const PROJECTS = path.join(__dirname, 'fixtures', 'projects');

test('lists memory files per project', () => {
  const result = readMemory(PROJECTS);
  const projA = result.find(r => r.project === 'proj-a');
  assert.ok(projA);
  const names = projA.files.map(f => f.name).sort();
  assert.deepStrictEqual(names, ['MEMORY.md', 'some-fact.md']);
});

test('returns [] for missing projects dir', () => {
  assert.deepStrictEqual(readMemory('/no/such/dir'), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/memory.test.js`
Expected: FAIL — `Cannot find module '../src/sources/memory.js'`

- [ ] **Step 4: Write `src/sources/memory.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/memory.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/memory.js test/memory.test.js test/fixtures/projects/proj-a/memory/
git commit -m "feat: memory source"
```

---

## Task 10: Tasks source (`sources/tasks.js`)

**Files:**
- Create: `src/sources/tasks.js`
- Create: `test/fixtures/tasks/sess1/.keep`
- Test: `test/tasks.test.js`

- [ ] **Step 1: Create fixture directory**

Create an empty file `test/fixtures/tasks/sess1/.keep` so the `tasks/sess1` directory exists in git.

- [ ] **Step 2: Write the failing test**

`test/tasks.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readTasks } = require('../src/sources/tasks.js');

test('lists task session directories', () => {
  const result = readTasks(path.join(__dirname, 'fixtures', 'tasks'));
  const sess = result.find(r => r.sessionId === 'sess1');
  assert.ok(sess);
  assert.ok(typeof sess.fileCount === 'number');
});

test('returns [] for missing tasks dir', () => {
  assert.deepStrictEqual(readTasks('/no/such/dir'), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/tasks.test.js`
Expected: FAIL — `Cannot find module '../src/sources/tasks.js'`

- [ ] **Step 4: Write `src/sources/tasks.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/tasks.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/sources/tasks.js test/tasks.test.js test/fixtures/tasks/
git commit -m "feat: tasks source"
```

---

## Task 11: Incremental cache (`cache.js`)

**Files:**
- Create: `src/cache.js`
- Test: `test/cache.test.js`

- [ ] **Step 1: Write the failing test** (reuses the session fixture from Task 4)

`test/cache.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createCache } = require('../src/cache.js');

const pricing = require('../src/pricing.json');
const config = { RUNNING_THRESHOLD_MS: 60_000, IDLE_THRESHOLD_MS: 1_800_000 };
const PROJECTS = path.join(__dirname, 'fixtures', 'projects');

test('refresh returns cards and overview from fixture transcripts', () => {
  const cache = createCache({ projectsDir: PROJECTS, pricing, config });
  const now = Date.parse('2026-06-13T14:31:10.000Z'); // ~6s after sess1 last activity
  const snap = cache.refresh(now);
  const card = snap.cards.find(c => c.sessionId === 'sess1');
  assert.ok(card);
  assert.strictEqual(card.status, 'running');
  assert.strictEqual(card.turns, 2);
  assert.strictEqual(snap.overview.totalSessions, snap.cards.length);
  assert.ok(snap.overview.totalSessions >= 1);
});

test('second refresh reuses cache when mtime unchanged (same result)', () => {
  const cache = createCache({ projectsDir: PROJECTS, pricing, config });
  const now = Date.parse('2026-06-13T14:31:10.000Z');
  const a = cache.refresh(now);
  const b = cache.refresh(now);
  assert.deepStrictEqual(a.overview, b.overview);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cache.test.js`
Expected: FAIL — `Cannot find module '../src/cache.js'`

- [ ] **Step 3: Write `src/cache.js`**

```js
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
    return { cards, overview: buildOverview(cards) };
  }

  return { refresh };
}

module.exports = { createCache };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cache.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat: incremental mtime-based session cache"
```

---

## Task 12: HTTP server (`server.js`)

**Files:**
- Create: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: Write the failing test**

`test/server.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createServer } = require('../src/server.js');

const FIX = path.join(__dirname, 'fixtures');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    require('http').get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('serves overview, sessions, mcp, skills, memory endpoints', async () => {
  const config = {
    PROJECTS_DIR: path.join(FIX, 'projects'),
    SESSION_STATS: path.join(FIX, '.session-stats.json'),
    CLAUDE_JSON: path.join(FIX, 'claude.json'),
    MCP_AUTH_CACHE: path.join(FIX, 'mcp-needs-auth-cache.json'),
    INSTALLED_PLUGINS: path.join(FIX, 'plugins', 'installed_plugins.json'),
    SETTINGS: path.join(FIX, 'settings.json'),
    TASKS_DIR: path.join(FIX, 'tasks'),
    RUNNING_THRESHOLD_MS: 60_000,
    IDLE_THRESHOLD_MS: 1_800_000,
    POLL_MS: 999_999, // effectively disable auto-poll during test
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const ov = await get(port, '/api/overview');
    assert.strictEqual(ov.status, 200);
    assert.ok(JSON.parse(ov.body).totalSessions >= 1);

    const sessions = await get(port, '/api/sessions');
    assert.strictEqual(sessions.status, 200);
    assert.ok(Array.isArray(JSON.parse(sessions.body)));

    const mcp = await get(port, '/api/mcp');
    assert.ok(Array.isArray(JSON.parse(mcp.body)));

    const skills = await get(port, '/api/skills');
    assert.ok(Array.isArray(JSON.parse(skills.body)));

    const memory = await get(port, '/api/memory');
    assert.ok(Array.isArray(JSON.parse(memory.body)));

    const missing = await get(port, '/api/nope');
    assert.strictEqual(missing.status, 404);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 3: Write `src/server.js`**

```js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createCache } = require('./cache.js');
const { readMcpServers } = require('./sources/mcp.js');
const { readSkills } = require('./sources/skills.js');
const { readMemory } = require('./sources/memory.js');
const { readTasks } = require('./sources/tasks.js');
const { readSessionStats } = require('./sources/sessionStats.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer({ config, pricing }) {
  const cache = createCache({ projectsDir: config.PROJECTS_DIR, pricing, config });
  let snapshot = cache.refresh();
  const timer = setInterval(() => { snapshot = cache.refresh(); }, config.POLL_MS);
  if (timer.unref) timer.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/overview') return sendJson(res, 200, snapshot.overview);
    if (p === '/api/sessions') {
      const project = url.searchParams.get('project');
      const cards = project ? snapshot.cards.filter(c => c.project === project) : snapshot.cards;
      return sendJson(res, 200, cards);
    }
    if (p.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(p.slice('/api/sessions/'.length));
      const card = snapshot.cards.find(c => c.sessionId === id);
      if (!card) return sendJson(res, 404, { error: 'not found' });
      const stats = readSessionStats(config.SESSION_STATS)[id] || null;
      return sendJson(res, 200, { ...card, toolCounts: stats ? stats.tool_counts : {} });
    }
    if (p === '/api/mcp') return sendJson(res, 200, readMcpServers(config.CLAUDE_JSON, config.MCP_AUTH_CACHE));
    if (p === '/api/skills') return sendJson(res, 200, readSkills(config.INSTALLED_PLUGINS, config.SETTINGS));
    if (p === '/api/memory') return sendJson(res, 200, readMemory(config.PROJECTS_DIR));
    if (p === '/api/tasks') return sendJson(res, 200, readTasks(config.TASKS_DIR));
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });

    return serveStatic(res, p);
  });

  return { server, stop: () => clearInterval(timer) };
}

if (require.main === module) {
  const config = require('./config.js');
  const pricing = require('./pricing.json');
  const { server } = createServer({ config, pricing });
  server.listen(config.PORT, '127.0.0.1', () => {
    console.log(`Claude Dashboard → http://localhost:${config.PORT}`);
  });
}

module.exports = { createServer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: HTTP server with API routes + static serving"
```

---

## Task 13: Frontend (`public/`)

The frontend is static and verified by running the app (Task 14), not by unit tests.

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] **Step 1: Write `public/index.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claude Dashboard</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <header id="kpi-bar">
    <div class="kpi"><span class="kpi-label">전체 세션</span><span id="kpi-sessions" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">실행중</span><span id="kpi-running" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">누적 턴</span><span id="kpi-turns" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">입력 토큰</span><span id="kpi-input" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">출력 토큰</span><span id="kpi-output" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">평균 응답</span><span id="kpi-latency" class="kpi-value">–</span></div>
    <div class="kpi"><span class="kpi-label">추정 비용</span><span id="kpi-cost" class="kpi-value">–</span></div>
  </header>

  <nav id="tabs">
    <button class="tab active" data-tab="sessions">세션</button>
    <button class="tab" data-tab="mcp">MCP</button>
    <button class="tab" data-tab="skills">스킬</button>
    <button class="tab" data-tab="memory">메모리</button>
  </nav>

  <main>
    <section id="panel-sessions" class="panel active">
      <div class="toolbar">
        <label>프로젝트: <select id="project-filter"><option value="">전체</option></select></label>
      </div>
      <div id="session-cards" class="cards"></div>
    </section>
    <section id="panel-mcp" class="panel"><table class="data-table" id="mcp-table"></table></section>
    <section id="panel-skills" class="panel"><table class="data-table" id="skills-table"></table></section>
    <section id="panel-memory" class="panel"><div id="memory-list"></div></section>
  </main>

  <div id="modal" class="modal hidden">
    <div class="modal-body">
      <button id="modal-close">✕</button>
      <h2 id="modal-title"></h2>
      <div id="modal-meta"></div>
      <canvas id="tool-chart"></canvas>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/styles.css`**

```css
:root { --bg:#0f1115; --panel:#1a1d24; --line:#2a2e38; --text:#e6e8ec; --muted:#8b90a0; --accent:#7c5cff; }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); }

#kpi-bar { display:flex; gap:8px; flex-wrap:wrap; padding:16px; background:var(--panel); border-bottom:1px solid var(--line); }
.kpi { flex:1; min-width:120px; background:#13151b; border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
.kpi-label { display:block; font-size:12px; color:var(--muted); }
.kpi-value { display:block; font-size:22px; font-weight:700; margin-top:4px; }

#tabs { display:flex; gap:4px; padding:12px 16px 0; }
.tab { background:transparent; color:var(--muted); border:none; padding:10px 16px; cursor:pointer; border-radius:8px 8px 0 0; font-size:14px; }
.tab.active { color:var(--text); background:var(--panel); }

main { padding:16px; }
.panel { display:none; }
.panel.active { display:block; }

.toolbar { margin-bottom:12px; color:var(--muted); }
.toolbar select { background:#13151b; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px; }

.cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; cursor:pointer; transition:border-color .15s; }
.card:hover { border-color:var(--accent); }
.card-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.dot { width:10px; height:10px; border-radius:50%; flex:none; }
.dot.running { background:#37d67a; } .dot.waiting { background:#f5c542; }
.dot.idle { background:#6b7280; } .dot.error { background:#ef4444; }
.card-title { font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.card-stats { font-size:12px; color:var(--muted); line-height:1.6; }

.data-table { width:100%; border-collapse:collapse; }
.data-table td, .data-table th { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); font-size:13px; }
.badge { padding:2px 8px; border-radius:999px; font-size:11px; }
.badge.ok { background:#1f3d2b; color:#37d67a; } .badge.warn { background:#3d3320; color:#f5c542; }

.modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
.modal.hidden { display:none; }
.modal-body { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; width:min(560px,90vw); position:relative; }
#modal-close { position:absolute; top:12px; right:12px; background:none; border:none; color:var(--muted); font-size:16px; cursor:pointer; }
#modal-meta { color:var(--muted); font-size:13px; margin-bottom:16px; }
```

- [ ] **Step 3: Write `public/app.js`**

```js
const POLL_MS = 5000;
const fmt = (n) => n == null ? '–' : Intl.NumberFormat().format(n);
const fmtTokens = (n) => n == null ? '–' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);
const fmtMs = (ms) => ms == null ? '–' : (ms/1000).toFixed(1)+'s';
const fmtUsd = (n) => n == null ? '–' : '$'+n.toFixed(2);

async function getJson(url) { const r = await fetch(url); return r.json(); }

async function refreshOverview() {
  const o = await getJson('/api/overview');
  document.getElementById('kpi-sessions').textContent = fmt(o.totalSessions);
  document.getElementById('kpi-running').textContent = fmt(o.runningSessions);
  document.getElementById('kpi-turns').textContent = fmt(o.totalTurns);
  document.getElementById('kpi-input').textContent = fmtTokens(o.totalInputTokens);
  document.getElementById('kpi-output').textContent = fmtTokens(o.totalOutputTokens);
  document.getElementById('kpi-latency').textContent = fmtMs(o.avgResponseMs);
  document.getElementById('kpi-cost').textContent = fmtUsd(o.estimatedCostUsd);
}

let knownProjects = new Set();
async function refreshSessions() {
  const filter = document.getElementById('project-filter').value;
  const cards = await getJson('/api/sessions' + (filter ? '?project='+encodeURIComponent(filter) : ''));
  const all = filter ? null : cards;
  if (all) {
    for (const c of all) knownProjects.add(c.project);
    const sel = document.getElementById('project-filter');
    for (const proj of [...knownProjects].sort()) {
      if (![...sel.options].some(o => o.value === proj)) {
        const opt = document.createElement('option'); opt.value = proj; opt.textContent = proj; sel.appendChild(opt);
      }
    }
  }
  const container = document.getElementById('session-cards');
  container.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="card-head"><span class="dot ${c.status}"></span><span class="card-title">${c.project}</span></div>
      <div class="card-stats">
        턴 ${fmt(c.turns)} · 토큰 ${fmtTokens(c.tokens.input + c.tokens.output)}<br>
        지연 ${fmtMs(c.avgResponseMs)} · ${fmtUsd(c.costUsd)}<br>
        <span style="opacity:.6">${c.sessionId.slice(0,8)}</span>
      </div>`;
    div.onclick = () => openModal(c.sessionId);
    container.appendChild(div);
  }
}

let toolChart = null;
async function openModal(id) {
  const d = await getJson('/api/sessions/' + encodeURIComponent(id));
  document.getElementById('modal-title').textContent = d.project;
  document.getElementById('modal-meta').textContent =
    `${d.model || 'unknown'} · 턴 ${fmt(d.turns)} · ${fmtUsd(d.costUsd)} · 상태 ${d.status}`;
  const counts = d.toolCounts || {};
  const labels = Object.keys(counts);
  const data = labels.map(k => counts[k]);
  if (toolChart) toolChart.destroy();
  toolChart = new Chart(document.getElementById('tool-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: '도구 호출', data, backgroundColor: '#7c5cff' }] },
    options: { plugins: { legend: { display:false } }, scales: { x: { ticks: { color:'#8b90a0' } }, y: { ticks: { color:'#8b90a0' } } } },
  });
  document.getElementById('modal').classList.remove('hidden');
}

async function renderMcp() {
  const rows = await getJson('/api/mcp');
  document.getElementById('mcp-table').innerHTML =
    '<tr><th>서버</th><th>설정됨</th><th>인증 필요</th></tr>' +
    rows.map(s => `<tr><td>${s.name}</td><td>${s.configured?'✓':'–'}</td><td>${s.needsAuth?'<span class="badge warn">필요</span>':'<span class="badge ok">OK</span>'}</td></tr>`).join('');
}
async function renderSkills() {
  const rows = await getJson('/api/skills');
  document.getElementById('skills-table').innerHTML =
    '<tr><th>플러그인</th><th>버전</th><th>활성</th></tr>' +
    rows.map(s => `<tr><td>${s.name}</td><td>${s.version||'–'}</td><td>${s.enabled?'<span class="badge ok">활성</span>':'–'}</td></tr>`).join('');
}
async function renderMemory() {
  const rows = await getJson('/api/memory');
  document.getElementById('memory-list').innerHTML =
    rows.map(r => `<h3>${r.project}</h3><div class="card-stats">${r.files.map(f => f.name).join(', ')}</div>`).join('') || '<p>메모리 없음</p>';
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.getElementById('panel-' + name).classList.add('active');
      if (name === 'mcp') renderMcp();
      if (name === 'skills') renderSkills();
      if (name === 'memory') renderMemory();
    };
  });
}

document.getElementById('modal-close').onclick = () => document.getElementById('modal').classList.add('hidden');
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };
document.getElementById('project-filter').onchange = refreshSessions;

setupTabs();
async function tick() { await refreshOverview(); await refreshSessions(); }
tick();
setInterval(tick, POLL_MS);
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: dashboard frontend (KPI bar, tabs, session cards, detail modal)"
```

---

## Task 14: Run verification & README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (no failures)

- [ ] **Step 2: Start the server against real `~/.claude`**

Run (Windows PowerShell): `node src/server.js`
Expected: prints `Claude Dashboard → http://localhost:7878`

> If port 7878 is unavailable on Windows (Hyper-V reserved range), set another: `$env:PORT=8473; node src/server.js`.

- [ ] **Step 3: Manually verify in browser**

Open `http://localhost:7878` and confirm:
- KPI bar shows non-zero 전체 세션 / 누적 턴 / 토큰 / 추정 비용
- Session cards render with status dots; recently-active sessions show 🟢
- Project filter dropdown populates and filters cards
- Clicking a card opens the modal with a tool-usage bar chart
- MCP / 스킬 / 메모리 tabs each load data

- [ ] **Step 4: Write `README.md`**

```markdown
# Claude Dashboard

Local read-only dashboard for visualizing Claude Code state (sessions, MCP, skills, memory, tasks). Reads `~/.claude`; never modifies it.

## Run

```bash
npm start            # → http://localhost:7878
```

Override port / poll interval / data dir via env vars:

```bash
PORT=8473 POLL_MS=3000 CLAUDE_DIR=/custom/.claude npm start
```

## Test

```bash
npm test             # node --test
```

## Cost estimates

`src/pricing.json` holds per-million-token USD rates per model. Edit it to match
current pricing — the figures shipped are estimates and the API does not provide rates.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add README and run instructions"
```

---

## Self-Review Notes

- **Spec coverage:** Sessions/tokens/turns/latency (Tasks 4,5,11), status dots (Task 3), cost (Task 2, pricing.json Task 1), KPI overview (Task 5), MCP (Task 7), skills (Task 8), memory (Task 9), tasks (Task 10), layout B with KPI bar + tabs + card grid + detail modal (Task 13), incremental polling cache (Task 11), error handling via try/catch + line-skip + per-source isolation (Tasks 4,6–10,12), tests (every task). All §-sections of the spec map to a task.
- **Type consistency:** `SessionSummary` → `SessionCard` (`status`, `costUsd`) → `Overview` field names are identical across Tasks 4/5/11/12 and consumed unchanged by `app.js`. `computeCost(tokens, model, pricing)`, `computeStatus(summary, now, config)`, `createCache({projectsDir,pricing,config}).refresh(now)`, `createServer({config,pricing})→{server,stop}` signatures match every call site.
- **No placeholders:** every code step contains complete, runnable code.
```
