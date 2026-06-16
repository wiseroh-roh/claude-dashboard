# 메모리 삭제(휴지통 이동) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모리 상세 모달에서 메모리 파일을 휴지통(`~/.claude/.trash/memory/`)으로 이동(복구 가능)한다.

**Architecture:** 순수 함수 `moveMemoryToTrash`(파일 이동 + 경로 검증)를 새 모듈로 만들고, 기존 `/api/memory/file` 라우트에 `DELETE` 분기를 추가한다. 프론트는 메모리 모달(`#mem-modal`)에 2단계 확인 삭제 UI를 둔다. 세션 삭제·메모리 뷰어 패턴을 그대로 따른다.

**Tech Stack:** Node.js 내장(fs/path/http), `node --test`. 프론트는 바닐라 HTML/CSS/JS. `src/`는 TDD, `public/`은 단위 테스트 하네스가 없어 브라우저 수동 검증.

---

## 사전 메모 (구현자 필독)

- 작업 디렉터리: `D:/dev_project/claude-dashboard`, 브랜치: `feature/memory-delete`.
- 테스트 실행: `node --test`. 기존 52개 + 신규가 모두 통과해야 한다.
- **중요:** 메모리 삭제 서버 테스트는 공유 픽스처(`test/fixtures/projects`)를 직접 변형하면 안 된다. `fs.mkdtempSync` + `fs.cpSync(..., { recursive: true })`로 임시 복제본을 만들어 그 위에서 수행한다.
- `test/server.test.js`에는 **세션 삭제 작업에서 추가된 `del_(port, urlPath)` 헬퍼와 `fs`/`os` require가 이미 있다 — 재사용**한다(중복 선언 금지).
- 메모리 파일 경로: `projectsDir/<project>/memory/<name>`. 검증/이동 패턴은 `src/actions/deleteSession.js`, `src/sources/memoryFile.js`와 동일.

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/actions/deleteMemory.js` | 메모리 파일을 휴지통으로 이동 + 경로 검증 | 신규 |
| `src/config.js` | 설정 | `MEMORY_TRASH_DIR` 추가 |
| `src/server.js` | HTTP 라우팅 | `/api/memory/file`에 `DELETE` 분기 |
| `public/index.html` | 모달 마크업 | `#mem-modal`에 `#mem-modal-actions` + 삭제 버튼 |
| `public/app.js` | 메모리 모달 상호작용 | `currentMemory` 추적 + 2단계 삭제 흐름 |
| `public/styles.css` | 스타일 | `#mem-modal-actions`를 기존 액션 스타일에 포함 |
| `test/deleteMemory.test.js` | 액션 단위 테스트 | 신규 |
| `test/server.test.js` | 서버 테스트 | `DELETE /api/memory/file` 테스트 추가 |

---

## Task 1: 액션 모듈 `moveMemoryToTrash` (TDD)

**Files:**
- Create: `src/actions/deleteMemory.js`
- Test: `test/deleteMemory.test.js`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/deleteMemory.test.js` 생성:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moveMemoryToTrash } = require('../src/actions/deleteMemory.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-memdel-')); }

test('moves a memory file into the trash dir with a collision-safe name', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const memDir = path.join(projectsDir, 'p', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const file = path.join(memDir, 'a.md');
  fs.writeFileSync(file, 'note\n');
  const trashDir = path.join(root, '.trash', 'memory');

  const { trashedTo } = moveMemoryToTrash({ projectsDir, trashDir, project: 'p', name: 'a.md', now: 999 });

  assert.strictEqual(fs.existsSync(file), false, 'original removed');
  assert.strictEqual(fs.existsSync(trashedTo), true, 'trash copy exists');
  assert.strictEqual(path.basename(trashedTo), 'p__999__a.md');
});

test('rejects a name with traversal (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  assert.throws(
    () => moveMemoryToTrash({ projectsDir, trashDir: path.join(root, '.trash'), project: 'p', name: '../../secret.md', now: 1 }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing memory file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(path.join(projectsDir, 'p', 'memory'), { recursive: true });
  assert.throws(
    () => moveMemoryToTrash({ projectsDir, trashDir: path.join(root, '.trash'), project: 'p', name: 'nope.md', now: 1 }),
    (e) => e.code === 'ENOENT'
  );
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/deleteMemory.test.js`
Expected: FAIL — `Cannot find module '../src/actions/deleteMemory.js'`.

- [ ] **Step 3: 최소 구현** — `src/actions/deleteMemory.js` 생성:

```js
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/deleteMemory.test.js`
Expected: PASS — 3개 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/actions/deleteMemory.js test/deleteMemory.test.js
git commit -m "feat: 메모리 파일을 휴지통으로 이동하는 moveMemoryToTrash 추가"
```

---

## Task 2: config `MEMORY_TRASH_DIR` + 서버 `DELETE /api/memory/file` (TDD)

**Files:**
- Modify: `src/config.js`
- Modify: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: 실패하는 테스트 추가** — `test/server.test.js` 끝에 추가. (`del_`, `get`, `fs`, `os`, `FIX`는 이미 파일에 존재 — 재사용.)

```js
test('DELETE /api/memory/file moves the memory file to trash and drops it from listing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-memsrv-'));
  fs.cpSync(path.join(FIX, 'projects'), path.join(root, 'projects'), { recursive: true });
  const memTrash = path.join(root, '.trash', 'memory');
  const config = {
    PROJECTS_DIR: path.join(root, 'projects'),
    SESSION_STATS: path.join(FIX, '.session-stats.json'),
    CLAUDE_JSON: path.join(FIX, 'claude.json'),
    MCP_AUTH_CACHE: path.join(FIX, 'mcp-needs-auth-cache.json'),
    INSTALLED_PLUGINS: path.join(FIX, 'plugins', 'installed_plugins.json'),
    SETTINGS: path.join(FIX, 'settings.json'),
    TASKS_DIR: path.join(FIX, 'tasks'),
    MEMORY_TRASH_DIR: memTrash,
    RUNNING_THRESHOLD_MS: 60_000,
    IDLE_THRESHOLD_MS: 1_800_000,
    POLL_MS: 999_999,
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const del = await del_(port, '/api/memory/file?project=proj-a&name=some-fact.md');
    assert.strictEqual(del.status, 200);
    assert.strictEqual(JSON.parse(del.body).ok, true);

    const trashed = fs.readdirSync(memTrash);
    assert.ok(trashed.some(f => f.startsWith('proj-a__') && f.endsWith('__some-fact.md')), 'moved to memory trash');

    const mem = JSON.parse((await get(port, '/api/memory')).body);
    const projA = mem.find(m => m.project === 'proj-a');
    assert.ok(projA && !projA.files.some(f => f.name === 'some-fact.md'), 'some-fact.md gone from listing');

    const bad = await del_(port, '/api/memory/file?project=proj-a&name=' + encodeURIComponent('../../etc'));
    assert.strictEqual(bad.status, 400);

    const miss = await del_(port, '/api/memory/file?project=proj-a&name=nope.md');
    assert.strictEqual(miss.status, 404);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/server.test.js`
Expected: FAIL — `DELETE /api/memory/file`는 현재 메서드 분기가 없어 GET 로직(`readMemoryFile`)을 타고, `some-fact.md`가 존재하므로 200 + `{project,name,content}`(ok 필드 없음)를 반환 → `JSON.parse(del.body).ok === true` 단언에서 실패.

- [ ] **Step 3: config 구현** — `src/config.js`의 `module.exports`에서 `TRASH_DIR` 줄 다음에 추가:

변경 전:
```js
  TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'sessions'),
```
변경 후:
```js
  TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'sessions'),
  MEMORY_TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'memory'),
```

- [ ] **Step 4: 서버 구현** — `src/server.js` 변경 두 가지.

(4a) 상단 require 블록에서 `const { readMemoryFile } = require('./sources/memoryFile.js');` 다음 줄에 추가:
```js
const { moveMemoryToTrash } = require('./actions/deleteMemory.js');
```

(4b) 기존 `/api/memory/file` 블록에서, `project`/`name` 누락 400 검사 줄 다음·기존 GET `try` 블록 앞에 DELETE 분기를 삽입한다.

변경 전:
```js
    if (p === '/api/memory/file') {
      const project = url.searchParams.get('project');
      const name = url.searchParams.get('name');
      if (!project || !name) return sendJson(res, 400, { error: 'project and name required' });
      try {
        const { content } = readMemoryFile({ projectsDir: config.PROJECTS_DIR, project, name });
        return sendJson(res, 200, { project, name, content });
      } catch (e) {
        if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 500, { error: e.message });
      }
    }
```
변경 후:
```js
    if (p === '/api/memory/file') {
      const project = url.searchParams.get('project');
      const name = url.searchParams.get('name');
      if (!project || !name) return sendJson(res, 400, { error: 'project and name required' });
      if (req.method === 'DELETE') {
        try {
          const { trashedTo } = moveMemoryToTrash({
            projectsDir: config.PROJECTS_DIR,
            trashDir: config.MEMORY_TRASH_DIR,
            project,
            name,
            now: Date.now(),
          });
          return sendJson(res, 200, { ok: true, trashedTo });
        } catch (e) {
          if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
          if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
          return sendJson(res, 500, { error: e.message });
        }
      }
      try {
        const { content } = readMemoryFile({ projectsDir: config.PROJECTS_DIR, project, name });
        return sendJson(res, 200, { project, name, content });
      } catch (e) {
        if (e.code === 'EOUTSIDE') return sendJson(res, 400, { error: e.message });
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 500, { error: e.message });
      }
    }
```

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `node --test test/server.test.js`
Expected: PASS. 이어서 전체 `node --test`도 통과 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/config.js src/server.js test/server.test.js
git commit -m "feat: DELETE /api/memory/file 라우트로 메모리 휴지통 이동"
```

---

## Task 3: 프론트엔드 메모리 모달 삭제 UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: 모달에 액션 영역 추가** — `public/index.html`의 `#mem-modal` 안 `<pre id="mem-content"></pre>` 다음 줄(닫는 `</div>` 앞)에 추가:

```html
      <div id="mem-modal-actions">
        <button id="mem-delete" class="btn-danger">메모리 삭제</button>
      </div>
```

- [ ] **Step 2: `app.js`에 현재 메모리 추적 + 삭제 흐름 추가** — `public/app.js`에서 `openMemoryModal` 함수 정의 **바로 앞**에 추가:

```js
let currentMemory = null;

function resetMemDeleteUI() {
  const box = document.getElementById('mem-modal-actions');
  box.innerHTML = '<button id="mem-delete" class="btn-danger">메모리 삭제</button>';
  document.getElementById('mem-delete').onclick = confirmMemDeleteUI;
}
function confirmMemDeleteUI() {
  const box = document.getElementById('mem-modal-actions');
  box.innerHTML =
    '<span class="confirm-text">정말 삭제할까요? 휴지통으로 이동합니다.</span>'
    + '<button id="mem-del-cancel" class="btn-ghost">취소</button>'
    + '<button id="mem-del-confirm" class="btn-danger">휴지통으로 이동</button>';
  document.getElementById('mem-del-cancel').onclick = resetMemDeleteUI;
  document.getElementById('mem-del-confirm').onclick = doMemDelete;
}
async function doMemDelete() {
  const box = document.getElementById('mem-modal-actions');
  try {
    const r = await fetch('/api/memory/file?project=' + encodeURIComponent(currentMemory.project) + '&name=' + encodeURIComponent(currentMemory.name), { method: 'DELETE' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      box.innerHTML = `<span class="error-text">삭제 실패: ${esc(e.error || r.status)}</span>`;
      return;
    }
    document.getElementById('mem-modal').classList.add('hidden');
    renderMemory();
  } catch (err) {
    box.innerHTML = `<span class="error-text">삭제 실패: ${esc(err.message)}</span>`;
  }
}
```

- [ ] **Step 3: `openMemoryModal`에서 상태 설정** — `public/app.js`의 `openMemoryModal(project, name)`에서 `document.getElementById('mem-modal-meta').textContent = '프로젝트: ' + project;` 줄 **다음**에 두 줄 추가:

```js
  currentMemory = { project, name };
  resetMemDeleteUI();
```

- [ ] **Step 4: `styles.css`에서 액션 스타일 공유** — `public/styles.css`의 기존 규칙

```css
#modal-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
```

의 선택자에 `#mem-modal-actions`를 추가한다(변경 후):

```css
#modal-actions, #mem-modal-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
```

(`.btn-danger`/`.btn-ghost`/`.confirm-text`/`.error-text`는 기존 그대로 재사용 — 추가 작업 없음.)

- [ ] **Step 5: 브라우저에서 검증 (안전한 임시 데이터로)**

공유/실제 데이터를 건드리지 않도록 픽스처 복제본 서버를 임시 포트로 띄워 확인한다.

```bash
node -e "const fs=require('fs'),os=require('os'),path=require('path');const r=fs.mkdtempSync(path.join(os.tmpdir(),'cd-memui-'));fs.cpSync('test/fixtures/projects',path.join(r,'projects'),{recursive:true});console.log(r)"
# 출력 경로를 <TMP>로:
PORT=7883 CLAUDE_DIR="<TMP>" CLAUDE_JSON="test/fixtures/claude.json" node src/server.js
```

브라우저 `http://localhost:7883` → "메모리" → 카드 클릭 → 확인:
- 모달 하단 우측에 빨간 "메모리 삭제" 버튼.
- 클릭 → "정말 삭제할까요? … [취소][휴지통으로 이동]"로 전환. "취소" → 복귀.
- "휴지통으로 이동" → 모달 닫히고 목록에서 해당 카드 사라짐.
- `<TMP>/.trash/memory/`에 `proj-a__<ts>__some-fact.md`(예) 생성 확인.
- 콘솔(F12) 에러 없음(favicon 404 무관).

확인 후 서버 종료. (수동 확인 — 자동화 테스트 아님)

- [ ] **Step 6: 커밋**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(ui): 메모리 모달에 삭제(휴지통 이동) 2단계 확인 UI 추가"
```

---

## 완료 기준

- `node --test` 전부 통과(기존 52 + 신규: deleteMemory 3, server 1).
- 메모리 모달에서 삭제 시 `.md`가 `~/.claude/.trash/memory/`로 이동하고 카드가 사라진다.
- 없는 파일 404, 경로 위반 400, 이동 실패 500.
- 브라우저 콘솔 에러 없음.
