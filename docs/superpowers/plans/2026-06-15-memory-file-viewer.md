# 메모리 파일 상세 레이어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모리 카드를 클릭하면 모달에서 그 파일의 원문(monospace)을 보여준다.

**Architecture:** 파일 내용을 읽는 순수 함수 `readMemoryFile`(경로 검증 포함)를 새 소스 모듈로 만들고, 서버에 `GET /api/memory/file` 라우트를 추가한다. 프론트는 메모리 카드에 클릭 핸들러를 달고, 세션 모달과 같은 오버레이를 재사용하는 별도 모달 `#mem-modal`에 원문을 표시한다.

**Tech Stack:** Node.js 내장(fs/path/http), `node --test`. 프론트는 바닐라 HTML/CSS/JS. `src/`는 TDD, `public/`은 단위 테스트 하네스가 없어 브라우저 수동 검증.

---

## 사전 메모 (구현자 필독)

- 작업 디렉터리: `D:/dev_project/claude-dashboard`, 브랜치: `feature/memory-file-viewer`.
- 테스트 실행: `node --test`. 기존 48개 + 신규가 모두 통과해야 한다.
- 메모리 파일 경로: `projectsDir/<project>/memory/<name>`. 데이터(`/api/memory`)는 내용을 주지 않으므로 새 엔드포인트로 읽는다.
- 보안: `name`/`project`로 경로를 만드므로 경로 탈출(`..`, 구분자)을 막아야 한다. 세션 삭제 때 쓴 검증 패턴(`src/actions/deleteSession.js`)과 동일한 스타일을 따른다.
- 픽스처 `test/fixtures/projects/proj-a/memory/some-fact.md`는 다음 내용이다(테스트에서 read-only 사용):
  ```
  ---
  name: some-fact
  description: a test fact
  ---
  body
  ```

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/sources/memoryFile.js` | 메모리 파일 원문 읽기 + 경로 검증 | 신규 |
| `src/server.js` | HTTP 라우팅 | `GET /api/memory/file` 추가 |
| `public/index.html` | 모달 마크업 | `#mem-modal` 추가 |
| `public/app.js` | 메모리 상호작용 | 카드 클릭 바인딩 + `openMemoryModal` + 닫기 핸들러 |
| `public/styles.css` | 스타일 | `#mem-content`/모달 제목·메타 |
| `test/memoryFile.test.js` | 소스 단위 테스트 | 신규 |
| `test/server.test.js` | 서버 테스트 | `/api/memory/file` 테스트 추가 |

---

## Task 1: 소스 모듈 `readMemoryFile` (TDD)

메모리 파일 원문을 읽는 순수 함수. 경로 탈출 방지.

**Files:**
- Create: `src/sources/memoryFile.js`
- Test: `test/memoryFile.test.js`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/memoryFile.test.js` 생성:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readMemoryFile } = require('../src/sources/memoryFile.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-mem-')); }

test('reads a memory file content', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  const memDir = path.join(projectsDir, 'p', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'a.md'), 'hello memory\n');

  const { content } = readMemoryFile({ projectsDir, project: 'p', name: 'a.md' });
  assert.strictEqual(content, 'hello memory\n');
});

test('rejects a name with traversal (EOUTSIDE)', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  assert.throws(
    () => readMemoryFile({ projectsDir, project: 'p', name: '../../secret.md' }),
    (e) => e.code === 'EOUTSIDE'
  );
});

test('throws ENOENT for a missing memory file', () => {
  const root = tmpRoot();
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(path.join(projectsDir, 'p', 'memory'), { recursive: true });
  assert.throws(
    () => readMemoryFile({ projectsDir, project: 'p', name: 'nope.md' }),
    (e) => e.code === 'ENOENT'
  );
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/memoryFile.test.js`
Expected: FAIL — `Cannot find module '../src/sources/memoryFile.js'`.

- [ ] **Step 3: 최소 구현** — `src/sources/memoryFile.js` 생성:

```js
const fs = require('fs');
const path = require('path');

// Read a memory file's raw content. Pure file-system helper — knows nothing
// about HTTP. Throws Error with .code 'EOUTSIDE' (name has separators/`..` or
// the resolved path escapes projectsDir) or 'ENOENT' (file missing).
function readMemoryFile({ projectsDir, project, name }) {
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
  return { content: fs.readFileSync(resolved, 'utf8') };
}

module.exports = { readMemoryFile };
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/memoryFile.test.js`
Expected: PASS — 3개 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/sources/memoryFile.js test/memoryFile.test.js
git commit -m "feat: 메모리 파일 원문을 읽는 readMemoryFile 추가"
```

---

## Task 2: 서버 `GET /api/memory/file` 라우트 (TDD)

**Files:**
- Modify: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: 실패하는 테스트 추가** — `test/server.test.js` 끝에 새 테스트를 추가한다. (기존 `get` 헬퍼와 `FIX` 상수를 재사용한다. 픽스처는 read-only로만 쓴다.)

```js
test('GET /api/memory/file returns content, 400 on traversal, 404 on missing', async () => {
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
    POLL_MS: 999_999,
  };
  const pricing = require('../src/pricing.json');
  const { server, stop } = createServer({ config, pricing });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const ok = await get(port, '/api/memory/file?project=proj-a&name=some-fact.md');
    assert.strictEqual(ok.status, 200);
    const body = JSON.parse(ok.body);
    assert.strictEqual(body.name, 'some-fact.md');
    assert.ok(body.content.includes('body'));
    assert.ok(body.content.includes('a test fact'));

    const bad = await get(port, '/api/memory/file?project=proj-a&name=' + encodeURIComponent('../../etc'));
    assert.strictEqual(bad.status, 400);

    const miss = await get(port, '/api/memory/file?project=proj-a&name=nope.md');
    assert.strictEqual(miss.status, 404);

    const noargs = await get(port, '/api/memory/file');
    assert.strictEqual(noargs.status, 400);
  } finally {
    stop();
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/server.test.js`
Expected: FAIL — `/api/memory/file`은 현재 라우트가 없어 `/api/` 404 폴백으로 가므로 `ok.status === 200` 단언에서 실패(404 반환).

- [ ] **Step 3: 서버 구현** — `src/server.js` 변경 두 가지.

(3a) 상단 require 블록(`moveSessionToTrash` require 다음 줄)에 추가:

```js
const { readMemoryFile } = require('./sources/memoryFile.js');
```

(3b) 요청 핸들러에서 기존 `if (p === '/api/memory') return sendJson(res, 200, readMemory(config.PROJECTS_DIR));` 줄 **다음에** 새 라우트를 추가:

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

(참고: `/api/memory`와 `/api/memory/file`은 둘 다 정확 일치(`===`)라 순서 무관하게 충돌하지 않는다.)

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/server.test.js`
Expected: PASS. 이어서 전체 `node --test`도 통과 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: GET /api/memory/file 라우트로 메모리 파일 원문 제공"
```

---

## Task 3: 프론트엔드 메모리 모달

메모리 카드를 클릭 가능하게 하고, 별도 모달에 원문을 표시한다.

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: 모달 마크업 추가** — `public/index.html`에서 기존 세션 모달 블록(`<div id="modal" ...> ... </div>`) **다음**, `<script src="/app.js"></script>` 줄 **앞**에 추가:

```html
  <div id="mem-modal" class="modal hidden">
    <div class="modal-body">
      <button id="mem-modal-close">✕</button>
      <h2 id="mem-modal-title"></h2>
      <div id="mem-modal-meta"></div>
      <pre id="mem-content"></pre>
    </div>
  </div>
```

- [ ] **Step 2: 카드에 data 속성 추가** — `public/app.js`의 `renderMemory()`에서 카드 템플릿의 여는 div를 수정한다.

변경 전:
```js
      return `<div class="mem-card" style="--c:${st.color}">
```
변경 후:
```js
      return `<div class="mem-card" data-project="${esc(r.project)}" data-name="${esc(f.name)}" style="--c:${st.color}">
```

- [ ] **Step 3: 렌더 후 클릭 핸들러 바인딩** — `public/app.js`의 `renderMemory()` 맨 끝, `document.getElementById('panel-memory').innerHTML = ...;` 줄 **다음**에 추가:

```js
  document.querySelectorAll('#panel-memory .mem-card').forEach(card => {
    card.onclick = () => openMemoryModal(card.dataset.project, card.dataset.name);
  });
```

- [ ] **Step 4: `openMemoryModal` 함수 추가** — `public/app.js`에서 `renderMemory` 함수 정의 **다음**(닫는 `}` 뒤)에 추가:

```js
async function openMemoryModal(project, name) {
  document.getElementById('mem-modal-title').textContent = name;
  document.getElementById('mem-modal-meta').textContent = '프로젝트: ' + project;
  const pre = document.getElementById('mem-content');
  pre.textContent = '불러오는 중…';
  document.getElementById('mem-modal').classList.remove('hidden');
  try {
    const r = await fetch('/api/memory/file?project=' + encodeURIComponent(project) + '&name=' + encodeURIComponent(name));
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      pre.textContent = '불러오기 실패: ' + (e.error || r.status);
      return;
    }
    const d = await r.json();
    pre.textContent = d.content;
  } catch (err) {
    pre.textContent = '불러오기 실패: ' + err.message;
  }
}
```

(`pre.textContent`로 넣으므로 HTML 주입 위험 없이 원문이 그대로 표시된다.)

- [ ] **Step 5: 닫기 핸들러 추가** — `public/app.js`의 기존 세션 모달 닫기 핸들러 두 줄

```js
document.getElementById('modal-close').onclick = () => document.getElementById('modal').classList.add('hidden');
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };
```

**다음**에 메모리 모달용 두 줄을 추가:

```js
document.getElementById('mem-modal-close').onclick = () => document.getElementById('mem-modal').classList.add('hidden');
document.getElementById('mem-modal').onclick = (e) => { if (e.target.id === 'mem-modal') e.currentTarget.classList.add('hidden'); };
```

- [ ] **Step 6: 스타일 추가** — `public/styles.css` 맨 끝에 추가:

```css
/* ---------- Memory file viewer ---------- */
.mem-card { cursor: pointer; }
#mem-modal-title { margin: 0 0 4px; font-size: 16px; word-break: break-all; }
#mem-modal-meta { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
#mem-content { max-height: 60vh; overflow: auto; margin: 0; padding: 14px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px; font-family: "Cascadia Code", Consolas, "Courier New", monospace; font-size: 12.5px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; }
```

- [ ] **Step 7: 브라우저에서 검증**

이 기능은 읽기 전용(GET)이라 픽스처를 변형하지 않으므로, 픽스처를 가리키는 서버를 임시 포트로 띄워 확인한다.

```bash
PORT=7881 CLAUDE_DIR="D:/dev_project/claude-dashboard/test/fixtures" CLAUDE_JSON="D:/dev_project/claude-dashboard/test/fixtures/claude.json" node src/server.js
```

브라우저에서 `http://localhost:7881` → 좌측 "메모리" 메뉴 → 확인:
- 카드에 마우스 올리면 포인터 커서.
- 카드 클릭 → 모달이 뜨고 제목=파일명, 메타="프로젝트: proj-a", 본문에 파일 원문(예: `some-fact.md`의 `---\nname: some-fact\n...\nbody`)이 monospace로 표시.
- ✕ 또는 배경 클릭 → 모달 닫힘.
- 콘솔(F12)에 에러 없음(favicon 404는 무관).

확인 후 서버 종료. (수동 확인 — 자동화 테스트 아님)

- [ ] **Step 8: 커밋**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat(ui): 메모리 카드 클릭 시 파일 원문 모달 표시"
```

---

## 완료 기준

- `node --test` 전부 통과(기존 48 + 신규: memoryFile 3, server 1).
- 메모리 카드 클릭 시 모달에서 파일 원문이 monospace로 보인다.
- 경로 탈출(`..`/구분자) 400, 없는 파일 404, 인자 누락 400.
- 브라우저 콘솔 에러 없음.
