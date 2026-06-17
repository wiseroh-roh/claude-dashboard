# Claude Dashboard — notes for Claude

Local web dashboard that reads `~/.claude` and shows Claude Code state. Vanilla Node (no runtime deps) + static `public/`.

## Run / verify
- `npm start` → http://localhost:7878 · `npm test` → `node --test`.
- **Restart the server after editing `src/`** — Node doesn't hot-reload. `public/` is served fresh per request (just refresh the browser); `src/` changes need a restart. (A stale server served an old route = the "불러오기 실패" bug.)
- No test harness for `public/` — `node --test` covers `src/` only. Verify frontend changes in a browser.
- Safe manual check against fixtures: `PORT=7880 CLAUDE_DIR=test/fixtures CLAUDE_JSON=test/fixtures/claude.json node src/server.js`.

## Testing
- `createServer({ config, pricing })` takes injectable config — tests override paths.
- Tests that mutate files (delete) MUST copy fixtures to a temp dir (`fs.mkdtempSync` + `fs.cpSync(..., {recursive:true})`) — never mutate `test/fixtures/`.

## Patterns
- A session = `~/.claude/projects/<project>/<sessionId>.jsonl`. Resolve a file from a sessionId via `cache.refresh().files`, NOT the filename (they can differ).
- File-op helpers (`src/actions/*`, `src/sources/memoryFile.js`) validate paths: reject name containing `/` `\` `..`; confirm resolved path is under `projectsDir`; throw `Error` with `.code` `EOUTSIDE` (→400) or `ENOENT` (→404).
- Deletes MOVE files to `~/.claude/.trash/{sessions,memory}/` (recoverable), never permanent.
- UI is Korean; `public/translations-ko.json` is a display-only layer (source data untouched). Chart.js is loaded from CDN (only external dep).

## Commits
- Conventional prefixes, Korean subjects: `feat(ui): …`, `docs: …`.
