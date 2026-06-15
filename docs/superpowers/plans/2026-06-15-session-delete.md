# 세션 삭제(휴지통 이동) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 상세 모달에서 세션 하나를 휴지통(`~/.claude/.trash/sessions/`)으로 이동(복구 가능)하는 기능을 추가한다.

**Architecture:** 순수 함수 `moveSessionToTrash`(파일 이동 + 경로 검증)를 새 모듈로 만들고, 캐시가 `sessionId → 파일경로` 맵을 노출하게 한 뒤, 서버에 `DELETE /api/sessions/:id` 라우트를 추가한다. 프론트는 모달에 2단계 확인 삭제 UI를 둔다.

**Tech Stack:** Node.js 내장 모듈(fs/path/http), `node --test`. 프론트는 바닐라 HTML/CSS/JS. `src/` 로직은 TDD 가능, `public/`은 단위 테스트 하네스가 없어 브라우저 수동 검증.

---

## 사전 메모 (구현자 필독)

- 작업 디렉터리: `D:/dev_project/claude-dashboard`, 브랜치: `feature/session-delete`.
- 테스트 실행: `node --test` (작업 디렉터리에서). 기존 43개 + 신규가 모두 통과해야 한다.
- **중요:** 세션 삭제 테스트는 절대 공유 픽스처(`test/fixtures/projects`)를 직접 변형하면 안 된다. 반드시 `fs.mkdtempSync` + `fs.cpSync(... , { recursive: true })`로 임시 복제본을 만들어 그 위에서 수행한다(다른 테스트 오염 방지).
- 한 "세션" = `projectsDir/<project>/<sessionId>.jsonl` 파일 1개. 카드의 `sessionId`는 파일명이 아니라 `.jsonl` 내부 값일 수 있으므로, 파일 경로는 캐시가 노출하는 맵으로 해석한다(파일명 가정 금지).

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/actions/deleteSession.js` | 세션 파일을 휴지통으로 이동(검증 포함)하는 순수 함수 | 신규 |
| `src/cache.js` | 트랜스크립트 → 카드/개요 스냅샷 | `refresh()` 스냅샷에 `files`(id→{file,project}) 추가 |
| `src/config.js` | 경로/임계값 설정 | `TRASH_DIR` 추가 |
| `src/server.js` | HTTP 라우팅 | `DELETE /api/sessions/:id` 추가 + 삭제 후 캐시 refresh |
| `public/index.html` | 모달 마크업 | `#modal-actions` + 삭제 버튼 |
| `public/app.js` | 모달 상호작용 | `currentSessionId` 추적 + 2단계 삭제 흐름 |
| `public/styles.css` | 스타일 | `.btn-danger`/`.btn-ghost`/`#modal-actions`/확인·에러 텍스트 |
| `test/deleteSession.test.js` | 액션 단위 테스트 | 신규 |
| `test/cache.test.js` | 캐시 테스트 | `files` 맵 테스트 추가 |
| `test/server.test.js` | 서버 테스트 | `DELETE` 테스트 + `del_` 헬퍼 추가 |

---

## Task 1: 액션 모듈 `moveSessionToTrash` (TDD)

세션 파일을 휴지통으로 이동하는 순수 함수. 경로 검증 + 충돌 방지 파일명.

**Files:**
- Create: `src/actions/deleteSession.js`
- Test: `test/deleteSession.test.js`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/deleteSession.test.js` 생성:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moveSessionToTrash } = require('../src/actions/deleteSession.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-del-')); }

test('moves a session file into the trash dir with a collision-safe name', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const projDir = path.join(projectsDir, 'p');
  fs.mkdirSync(projDir, { recursive: true });
  const file = path.join(projDir, 'x.jsonl');
  fs.writeFileSync(file, '{"sessionId":"x"}\n');
  const trashDir = path.join(root, '.trash', 'sessions');

  const { trashedTo } = moveSessionToTrash({ file, projectsDir, trashDir, project: 'p', sessionId: 'x', now: 1234 });

  assert.strictEqual(fs.existsSync(file), false, 'original removed');
  assert.strictEqual(fs.existsSync(trashedTo), true, 'trash copy exists');
  assert.strictEqual(path.basename(trashedTo), 'p__x__1234.jsonl');
});

test('refuses a file outside projectsDir (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  const outside = path.join(root, 'evil.jsonl');
  fs.writeFileSync(outside, 'x');
  assert.throws(
    () => moveSessionToTrash({ file: outside, projectsDir, trashDir: path.join(root, '.trash'), project: 'p', sessionId: 'e', now: 1 }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  const missing = path.join(projectsDir, 'nope.jsonl');
  assert.throws(
    () => moveSessionToTrash({ file: missing, projectsDir, trashDir: path.join(root, '.trash'), project: 'p', sessionId: 'n', now: 1 }),
    (e) => e.code === 'ENOENT'
  );
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/deleteSession.test.js`
Expected: FAIL — `Cannot find module '../src/actions/deleteSession.js'`.

- [ ] **Step 3: 최소 구현** — `src/actions/deleteSession.js` 생성:

```js
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/deleteSession.test.js`
Expected: PASS — 3개 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/actions/deleteSession.js test/deleteSession.test.js
git commit -m "feat: 세션을 휴지통으로 이동하는 moveSessionToTrash 추가"
```

---

## Task 2: 캐시 `files` 맵 + config `TRASH_DIR`

서버가 sessionId로 파일 경로를 찾을 수 있도록 캐시 스냅샷에 맵을 추가하고, 휴지통 경로를 설정에 추가한다.

**Files:**
- Modify: `src/cache.js`
- Modify: `src/config.js`
- Test: `test/cache.test.js`

- [ ] **Step 1: 실패하는 테스트 추가** — `test/cache.test.js` 끝에 추가:

```js
test('refresh exposes a sessionId -> file map', () => {
  const cache = createCache({ projectsDir: PROJECTS, pricing, config });
  const snap = cache.refresh(Date.parse('2026-06-13T14:31:10.000Z'));
  assert.ok(snap.files, 'snapshot has files map');
  assert.ok(snap.files.sess1, 'sess1 present in files map');
  assert.strictEqual(snap.files.sess1.project, 'proj-a');
  assert.ok(snap.files.sess1.file.endsWith('sess1.jsonl'));
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/cache.test.js`
Expected: FAIL — `snap.files`가 `undefined`라 `assert.ok(snap.files)`에서 실패.

- [ ] **Step 3: 캐시 구현** — `src/cache.js`의 `refresh()` 함수에서 `cards`를 만든 직후, `return` 문을 아래로 교체한다.

변경 전:
```js
    const cards = [...parsed.values()]
      .map(v => buildSessionCard(v.summary, { pricing, now, config }))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    return { cards, overview: buildOverview(cards) };
```

변경 후:
```js
    const cards = [...parsed.values()]
      .map(v => buildSessionCard(v.summary, { pricing, now, config }))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    const files = {};
    for (const [file, v] of parsed) {
      files[v.summary.sessionId] = { file, project: v.summary.project };
    }
    return { cards, overview: buildOverview(cards), files };
```

- [ ] **Step 4: config 구현** — `src/config.js`의 `module.exports` 객체에서 `SETTINGS` 줄 다음에 한 줄 추가:

변경 전:
```js
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  TASKS_DIR: path.join(CLAUDE_DIR, 'tasks'),
```

변경 후:
```js
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  TASKS_DIR: path.join(CLAUDE_DIR, 'tasks'),
  TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'sessions'),
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `node --test test/cache.test.js`
Expected: PASS — 기존 2개 + 신규 1개 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/cache.js src/config.js test/cache.test.js
git commit -m "feat: 캐시 스냅샷에 sessionId→파일 맵 추가, TRASH_DIR 설정"
```

---

## Task 3: 서버 `DELETE /api/sessions/:id` 라우트 (TDD)

세션을 휴지통으로 이동하는 HTTP 엔드포인트. 삭제 후 캐시를 즉시 갱신한다.

**Files:**
- Modify: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: 실패하는 테스트 + DELETE 헬퍼 추가** — `test/server.test.js`에 변경 두 가지.

(1) 파일 상단 `require`들 아래(예: `const FIX = ...` 줄 다음)에 `fs`/`os` require와 `del_` 헬퍼를 추가한다. 기존 `get` 헬퍼는 그대로 둔다.

```js
const fs = require('node:fs');
const os = require('node:os');

function del_(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = require('http').request(
      { host: '127.0.0.1', port, path: urlPath, method: 'DELETE' },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
```

(2) 파일 끝에 새 테스트를 추가한다. 공유 픽스처를 변형하지 않도록 임시 복제본을 쓴다.

```js
test('DELETE /api/sessions/:id moves the session to trash and drops it from listing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-srv-'));
  fs.cpSync(path.join(FIX, 'projects'), path.join(root, 'projects'), { recursive: true });
  const trashDir = path.join(root, '.trash', 'sessions');
  const config = {
    PROJECTS_DIR: path.join(root, 'projects'),
    SESSION_STATS: path.join(FIX, '.session-stats.json'),
    CLAUDE_JSON: path.join(FIX, 'claude.json'),
    MCP_AUTH_CACHE: path.join(FIX, 'mcp-needs-auth-cache.json'),
    INSTALLED_PLUGINS: path.join(FIX, 'plugins', 'installed_plugins.json'),
    SETTINGS: path.join(FIX, 'settings.json'),
    TASKS_DIR: path.join(FIX, 'tasks'),
    TRASH_DIR: trashDir,
    RUNNING_THRESHOLD_MS: 60_000,
    IDLE_THRESHOLD_MS: 1_800_000,
    POLL_MS: 999_999,
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const before = JSON.parse((await get(port, '/api/sessions')).body);
    assert.ok(before.some(c => c.sessionId === 'sess1'), 'sess1 present before delete');

    const res = await del_(port, '/api/sessions/sess1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(JSON.parse(res.body).ok, true);

    const trashed = fs.readdirSync(trashDir);
    assert.ok(trashed.some(f => f.startsWith('proj-a__sess1__') && f.endsWith('.jsonl')), 'file moved to trash');

    const after = JSON.parse((await get(port, '/api/sessions')).body);
    assert.ok(!after.some(c => c.sessionId === 'sess1'), 'sess1 gone after delete');

    const miss = await del_(port, '/api/sessions/does-not-exist');
    assert.strictEqual(miss.status, 404);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/server.test.js`
Expected: FAIL — 현재 `DELETE /api/sessions/sess1`는 메서드 구분 없이 GET 상세 핸들러로 가서 카드 JSON(200, `ok` 필드 없음)을 반환하므로 `JSON.parse(res.body).ok === true` 단언에서 실패.

- [ ] **Step 3: 서버 구현** — `src/server.js` 변경 두 가지.

(1) 상단 require 블록(`readInstall` require 다음 줄)에 액션 모듈 require 추가:

```js
const { moveSessionToTrash } = require('./actions/deleteSession.js');
```

(2) 요청 핸들러에서 `const p = url.pathname;` 다음 줄에, 기존 `if (p === '/api/overview') ...` 보다 **먼저** DELETE 분기를 넣는다:

```js
    if (req.method === 'DELETE' && p.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(p.slice('/api/sessions/'.length));
      const entry = snapshot.files[id];
      if (!entry) return sendJson(res, 404, { error: 'not found' });
      try {
        const { trashedTo } = moveSessionToTrash({
          file: entry.file,
          projectsDir: config.PROJECTS_DIR,
          trashDir: config.TRASH_DIR,
          project: entry.project,
          sessionId: id,
          now: Date.now(),
        });
        snapshot = cache.refresh();
        return sendJson(res, 200, { ok: true, trashedTo });
      } catch (e) {
        if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 500, { error: e.message });
      }
    }
```

(참고: `snapshot`은 `let snapshot = cache.refresh();`로 선언돼 재할당 가능하다. GET 라우트는 `req.method`가 DELETE가 아니므로 이 분기를 건너뛴다.)

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/server.test.js`
Expected: PASS — 기존 테스트 + 신규 DELETE 테스트 통과.

- [ ] **Step 5: 전체 테스트 확인 후 커밋**

Run: `node --test`
Expected: 전부 통과(기존 + Task 1·2·3 신규).

```bash
git add src/server.js test/server.test.js
git commit -m "feat: DELETE /api/sessions/:id 라우트로 세션 휴지통 이동"
```

---

## Task 4: 프론트엔드 모달 삭제 UI

상세 모달에 2단계 확인 삭제 버튼을 추가한다.

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: 모달에 액션 영역 추가** — `public/index.html`의 모달에서 `<canvas id="tool-chart"></canvas>` 다음 줄(닫는 `</div>` 직전)에 추가:

```html
      <div id="modal-actions">
        <button id="session-delete" class="btn-danger">세션 삭제</button>
      </div>
```

- [ ] **Step 2: `app.js`에 현재 세션 추적 + 삭제 흐름 추가** — `public/app.js`에서 `let toolChart = null;` 줄 다음에 추가:

```js
let currentSessionId = null;

function resetDeleteUI() {
  const box = document.getElementById('modal-actions');
  box.innerHTML = '<button id="session-delete" class="btn-danger">세션 삭제</button>';
  document.getElementById('session-delete').onclick = confirmDeleteUI;
}
function confirmDeleteUI() {
  const box = document.getElementById('modal-actions');
  box.innerHTML =
    '<span class="confirm-text">정말 삭제할까요? 휴지통으로 이동합니다.</span>'
    + '<button id="del-cancel" class="btn-ghost">취소</button>'
    + '<button id="del-confirm" class="btn-danger">휴지통으로 이동</button>';
  document.getElementById('del-cancel').onclick = resetDeleteUI;
  document.getElementById('del-confirm').onclick = doDelete;
}
async function doDelete() {
  const box = document.getElementById('modal-actions');
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(currentSessionId), { method: 'DELETE' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      box.innerHTML = `<span class="error-text">삭제 실패: ${esc(e.error || r.status)}</span>`;
      return;
    }
    document.getElementById('modal').classList.add('hidden');
    refreshSessions();
  } catch (err) {
    box.innerHTML = `<span class="error-text">삭제 실패: ${esc(err.message)}</span>`;
  }
}
```

- [ ] **Step 3: `openModal`에서 상태 설정** — `public/app.js`의 `openModal(id)` 함수에서 `const d = await getJson('/api/sessions/' + encodeURIComponent(id));` 줄 다음에 두 줄 추가:

```js
  currentSessionId = id;
  resetDeleteUI();
```

(이렇게 하면 모달을 열 때마다 현재 세션 id가 갱신되고 삭제 버튼이 기본 상태로 초기화된다.)

- [ ] **Step 4: `styles.css`에 버튼/액션 스타일 추가** — `public/styles.css` 맨 끝(반응형 `@media` 블록 다음)에 추가:

```css
/* ---------- Modal actions / delete ---------- */
#modal-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
.btn-danger { background: rgba(255,93,108,.14); color: var(--red); border: 1px solid rgba(255,93,108,.4); padding: 8px 14px; border-radius: 9px; font-size: 13px; font-weight: 650; cursor: pointer; transition: background .12s; }
.btn-danger:hover { background: rgba(255,93,108,.24); }
.btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); padding: 8px 14px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; transition: color .12s; }
.btn-ghost:hover { color: var(--text); }
.confirm-text { color: var(--text); font-size: 13px; margin-right: auto; }
.error-text { color: var(--red); font-size: 13px; margin-right: auto; }
```

- [ ] **Step 5: 브라우저에서 검증 (안전한 임시 데이터로)**

공유/실제 데이터를 건드리지 않도록, 픽스처 복제본을 가리키는 서버를 임시 포트로 띄워 확인한다.

```bash
# 임시 복제본 생성
node -e "const fs=require('fs'),os=require('os'),path=require('path');const r=fs.mkdtempSync(path.join(os.tmpdir(),'cd-ui-'));fs.cpSync('test/fixtures/projects',path.join(r,'projects'),{recursive:true});fs.cpSync('test/fixtures/.session-stats.json',path.join(r,'.session-stats.json'));console.log(r)"
# 위 출력 경로를 <TMP>로 사용:
PORT=7880 CLAUDE_DIR="<TMP>" CLAUDE_JSON="test/fixtures/claude.json" node src/server.js
```

브라우저에서 `http://localhost:7880` 열고 확인:
- 세션 카드 클릭 → 모달 하단 우측에 빨간 "세션 삭제" 버튼.
- 클릭 → "정말 삭제할까요? … [취소][휴지통으로 이동]"로 전환. "취소" → 원래 버튼 복귀.
- "휴지통으로 이동" → 모달 닫히고 목록에서 해당 세션 사라짐.
- `<TMP>/.trash/sessions/`에 `proj-a__sess1__<ts>.jsonl`이 생겼는지 확인.
- 콘솔(F12)에 에러 없음.

확인 후 서버 종료. (이 단계는 자동화 테스트가 아니라 수동 확인이다.)

- [ ] **Step 6: 커밋**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(ui): 모달에 세션 삭제(휴지통 이동) 2단계 확인 UI 추가"
```

---

## 완료 기준

- `node --test` 전부 통과(기존 43 + 신규: deleteSession 3, cache 1, server 1).
- 모달에서 세션 삭제 시 `.jsonl`이 `~/.claude/.trash/sessions/`로 이동하고 목록에서 사라진다.
- `.session-stats.json`·`tasks/`는 그대로 남아 복구 가능.
- 없는 id 삭제 시 404, 경로 위반 400, 이동 실패 500.
- 브라우저 콘솔 에러 없음.
