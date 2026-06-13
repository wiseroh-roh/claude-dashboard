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

> On Windows, the default port 7878 can collide with a Hyper-V reserved range. If startup fails with `EACCES`, pick another port, e.g. `PORT=8473 npm start`.

## Test

```bash
npm test             # node --test
```

## What it shows

- **KPI bar:** total sessions, running sessions, cumulative turns, input/output tokens, average response time, estimated cost.
- **Sessions tab:** card per session with a status dot (🟢 running / 🟡 waiting / ⚪ idle / 🔴 error), turns, tokens, and last latency. Filter by project; click a card for a tool-usage breakdown.
- **MCP / Skills / Memory tabs:** configured MCP servers (and auth state), installed plugins (and enabled state), and per-project memory files.

## Session status heuristic

Status is inferred from file activity (the API has no live "is running" signal):

- 🟢 **running** — last activity within 60s
- 🟡 **waiting** — last activity between 60s and 30min
- ⚪ **idle** — last activity over 30min ago
- 🔴 **error** — the session's *most recent* tool result was an error

Thresholds live in `src/config.js`.

## Cost estimates

`src/pricing.json` holds per-million-token USD rates per model. Edit it to match
current pricing — the figures shipped are estimates and the API does not provide rates.
