# 좌측 사이드바 + 메모리 카드 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 탭 메뉴를 좌측 사이드바로 옮기고, 메모리 탭을 유형별 색상 카드 그리드로 개선한다.

**Architecture:** 순수 프론트엔드 변경. `public/index.html`을 2단 그리드(`#sidebar | #content`)로 재구성하고, `public/styles.css`에 사이드바·카드 스타일을 추가하며, `public/app.js`의 `renderMemory()`를 카드 그리드로 재작성한다. 서버(`src/`)·API·데이터 스키마는 변경하지 않는다.

**Tech Stack:** 바닐라 HTML/CSS/JS (빌드 도구 없음), Node.js 내장 http 서버, Chart.js(CDN). 자동화 테스트(`node --test`)는 `src/`만 대상으로 하며 `public/`에는 단위 테스트 하네스가 없다 — UI 검증은 브라우저 수동 확인 + `npm test` 회귀 확인으로 한다.

---

## 사전 메모 (구현자 필독)

- 작업 디렉터리: `D:/dev_project/claude-dashboard`, 브랜치: `feature/left-sidebar-memory-ui`.
- 앱 실행: `npm start` → 콘솔에 출력되는 `http://localhost:<PORT>`(기본 포트는 `src/config.js` 참조)를 브라우저로 연다. 코드 수정 후에는 브라우저 새로고침(Ctrl+R)만 하면 반영된다(정적 서버라 재시작 불필요).
- `public/` 변경은 자동화 테스트에 영향이 없다. 회귀 확인용으로 `npm test`가 그대로 통과하는지만 마지막에 본다.
- 색상에 CSS `color-mix()`를 사용한다. 로컬 전용 대시보드이고 최신 브라우저(Chrome/Edge 111+) 기준이라 허용된다.

## File Structure

| 파일 | 책임 | 이 계획에서의 변경 |
|------|------|------|
| `public/index.html` | 페이지 골격·DOM 구조 | 2단 레이아웃(`#sidebar`+`#content`)으로 재구성. 탭 버튼을 사이드바 `#nav`로, 칩/KPI를 본문으로 이동 |
| `public/styles.css` | 모든 시각 스타일 | 레이아웃 그리드·사이드바·`#topbar` 추가, 구 `#app-bar`/`#tabs`/`.tab`/`.app-meta` 규칙 대체, 메모리 카드·요약·유형 색·반응형 추가 |
| `public/app.js` | 데이터 fetch·렌더·상호작용 | `setupTabs()` 셀렉터 갱신, `fmtKB`·`MEM_STYLE`·`memKind` 추가, `renderMemory()` 재작성 |

변경 없음: `src/**`, `test/**`, `public/translations-ko.json`, `package.json`.

---

## Task 1: 좌측 사이드바 레이아웃 (HTML + CSS + JS 셀렉터)

탭을 좌측 사이드바로 옮기는 구조 변경. 이 작업이 끝나면 좌측 메뉴로 패널 전환이 되고 현재 메뉴가 강조된다.

**Files:**
- Modify: `public/index.html` (전체 `<body>` 구조)
- Modify: `public/styles.css` (App bar/Tabs 섹션 대체 + 레이아웃 추가)
- Modify: `public/app.js` (`setupTabs()` 내 `.tab` → `.nav-item`)

- [ ] **Step 1: `index.html`의 `<body>` 내부를 2단 구조로 교체**

`public/index.html`에서 여는 `<body>` 태그 다음부터 `<script src="/app.js"></script>` 직전까지의 전체 내용(현재 11~70행: `<header id="app-bar">` ~ `</div>` 모달 닫힘)을 아래로 교체한다. `<head>`와 `<script src="/app.js">`, `</body></html>`는 그대로 둔다.

```html
  <div id="layout">
    <aside id="sidebar">
      <div class="brand">
        <div class="brand-mark">✦</div>
        <div class="brand-text">
          <div class="brand-title">Claude Dashboard</div>
          <div class="brand-sub">로컬 <code>~/.claude</code> 실시간 모니터</div>
        </div>
      </div>

      <nav id="nav">
        <button class="nav-item active" data-tab="sessions">세션</button>
        <button class="nav-item" data-tab="mcp">MCP</button>
        <button class="nav-item" data-tab="skills">스킬</button>
        <button class="nav-item" data-tab="memory">메모리</button>
        <button class="nav-item" data-tab="install">설치</button>
      </nav>

      <div class="sidebar-foot">
        <span id="live-chip" class="chip live"><span class="pulse"></span>실시간 · 5초</span>
      </div>
    </aside>

    <div id="content">
      <header id="topbar">
        <span id="cc-chip" class="chip">Claude Code …</span>
      </header>

      <section id="kpi-bar">
        <div class="kpi"><span class="kpi-label">전체 세션</span><span id="kpi-sessions" class="kpi-value">–</span></div>
        <div class="kpi accent-green"><span class="kpi-label">실행 중</span><span id="kpi-running" class="kpi-value">–</span></div>
        <div class="kpi"><span class="kpi-label">누적 턴</span><span id="kpi-turns" class="kpi-value">–</span></div>
        <div class="kpi"><span class="kpi-label">입력 토큰</span><span id="kpi-input" class="kpi-value">–</span></div>
        <div class="kpi"><span class="kpi-label">출력 토큰</span><span id="kpi-output" class="kpi-value">–</span></div>
        <div class="kpi"><span class="kpi-label">평균 응답</span><span id="kpi-latency" class="kpi-value">–</span></div>
        <div class="kpi accent-violet"><span class="kpi-label">추정 비용</span><span id="kpi-cost" class="kpi-value">–</span></div>
      </section>

      <main>
        <section id="panel-sessions" class="panel active">
          <div class="toolbar">
            <label>프로젝트 <select id="project-filter"><option value="">전체</option></select></label>
          </div>
          <div class="legend">
            <span class="legend-title">상태</span>
            <span class="legend-item"><span class="dot running"></span>실행중 <small>(최근 60초)</small></span>
            <span class="legend-item"><span class="dot waiting"></span>대기 <small>(60초~30분)</small></span>
            <span class="legend-item"><span class="dot idle"></span>유휴 <small>(30분+)</small></span>
            <span class="legend-item"><span class="dot error"></span>오류 <small>(마지막 도구 결과 오류)</small></span>
          </div>
          <div id="session-cards" class="cards"></div>
        </section>
        <section id="panel-mcp" class="panel"></section>
        <section id="panel-skills" class="panel"></section>
        <section id="panel-memory" class="panel"></section>
        <section id="panel-install" class="panel"></section>
      </main>
    </div>
  </div>

  <div id="modal" class="modal hidden">
    <div class="modal-body">
      <button id="modal-close">✕</button>
      <h2 id="modal-title"></h2>
      <div id="modal-meta"></div>
      <canvas id="tool-chart"></canvas>
    </div>
  </div>
```

- [ ] **Step 2: `styles.css`의 App bar 섹션을 레이아웃 + 사이드바 규칙으로 교체**

`public/styles.css`에서 `/* ---------- App bar ---------- */` 주석부터 그 아래 `#app-bar { ... }` 블록 전체(현재 36~43행)를 찾아 아래로 교체한다. `.brand`, `.brand-mark`, `.brand-title`, `.brand-sub`, `.chip`, `.chip.warn`, `.chip.live`, `.pulse` 규칙은 그대로 둔다(사이드바/topbar에서 재사용). 단 `.app-meta { ... }` 한 줄(현재 53행)은 더 이상 쓰지 않으므로 삭제한다.

교체해 넣을 내용:

```css
/* ---------- Layout ---------- */
#layout { display: grid; grid-template-columns: 210px 1fr; min-height: 100vh; }

#sidebar {
  position: sticky; top: 0; align-self: start; height: 100vh;
  display: flex; flex-direction: column; gap: 18px;
  padding: 18px 14px;
  border-right: 1px solid var(--line-soft);
  background: linear-gradient(180deg, rgba(22,26,35,.9), rgba(22,26,35,.55));
  backdrop-filter: blur(8px);
}
#sidebar .brand { padding: 4px 6px; }

#content { min-width: 0; display: flex; flex-direction: column; }
#topbar {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  min-height: 60px; padding: 14px 22px;
  border-bottom: 1px solid var(--line-soft);
}
```

- [ ] **Step 3: `styles.css`의 Tabs 섹션을 사이드바 네비게이션 규칙으로 교체**

`public/styles.css`에서 `/* ---------- Tabs ---------- */` 주석과 그 아래 `#tabs`, `.tab`, `.tab:hover`, `.tab.active` 규칙(현재 79~83행)을 찾아 아래로 교체한다.

```css
/* ---------- Sidebar nav ---------- */
#nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  text-align: left; background: transparent; color: var(--muted); border: none;
  padding: 10px 14px; cursor: pointer; border-radius: 9px;
  font-size: 13.5px; font-weight: 600; transition: all .12s;
}
.nav-item:hover { color: var(--text); background: rgba(255,255,255,.04); }
.nav-item.active { color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 4px 14px rgba(139,124,255,.4); }
.sidebar-foot { margin-top: auto; }
```

- [ ] **Step 4: `app.js`의 `setupTabs()` 셀렉터를 `.nav-item`으로 갱신**

`public/app.js`의 `setupTabs()` 함수(현재 171~185행)에서 `.tab`을 `.nav-item`으로 바꾼다. 두 군데다.

변경 전:
```js
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
```

변경 후:
```js
function setupTabs() {
  document.querySelectorAll('.nav-item').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
```

- [ ] **Step 5: 브라우저에서 레이아웃 검증**

Run: `npm start` (이미 실행 중이면 브라우저 새로고침)
브라우저에서 확인:
- 좌측에 사이드바(브랜드 + 세로 메뉴 5개 + 하단 "실시간 · 5초" 칩)가 보인다.
- 우측 본문 상단에 "Claude Code v…" 칩이 우측 정렬로 보인다.
- KPI 7개 카드가 본문 상단에 그리드로 보인다.
- 메뉴를 클릭하면 해당 패널로 전환되고 클릭한 메뉴가 보라 그라데이션으로 강조된다.
- 세션 카드가 정상 렌더된다(기존과 동일).

Expected: 위 모든 항목 정상. 콘솔(F12) 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat(ui): 탭 메뉴를 좌측 사이드바로 이동"
```

---

## Task 2: 메모리 카드 그리드 (JS + CSS)

메모리 탭을 유형별 색상 카드 그리드로 재작성하고 상단에 유형별 개수 요약을 추가한다.

**Files:**
- Modify: `public/app.js` (상수 추가 + `renderMemory()` 재작성)
- Modify: `public/styles.css` (메모리 카드/요약 규칙 추가)

- [ ] **Step 1: `app.js`에 포맷 함수·유형 스타일 상수 추가**

`public/app.js`의 기존 `const MEM_TYPE = {...};`(현재 9행) 바로 아래에 다음을 추가한다.

```js
const fmtKB = (n) => n == null ? '' : (n / 1024).toFixed(1) + ' KB';
const MEM_STYLE = {
  user:      { color: '#56b6ff', icon: '👤' },
  feedback:  { color: '#ffcc33', icon: '💬' },
  project:   { color: '#b06cff', icon: '📌' },
  reference: { color: '#3ddc84', icon: '🔗' },
  index:     { color: '#9aa3b8', icon: '🗂️' },
};
// 파일의 표시 유형(키)을 정한다: 알려진 type이면 그대로, MEMORY.md나 미상이면 'index'.
function memKind(f) {
  if (f.type && MEM_STYLE[f.type]) return f.type;
  return 'index';
}
```

- [ ] **Step 2: `app.js`의 `renderMemory()` 전체 재작성**

`public/app.js`의 기존 `renderMemory` 함수 전체(현재 110~123행)를 아래로 교체한다.

```js
async function renderMemory() {
  const [rows, tr] = [await getJson('/api/memory'), await ensureTR()];
  const memTr = tr.memoryByFile || {};
  const intro = `<p class="tab-intro">프로젝트별 <b>장기 메모리</b>입니다. Claude가 세션을 넘어 기억하는 사실로, 유형은 사용자·피드백·프로젝트·참고로 나뉩니다.</p>`;

  // 전체 유형별 개수 집계
  const counts = {};
  for (const r of rows) for (const f of r.files) {
    const k = memKind(f);
    counts[k] = (counts[k] || 0) + 1;
  }
  const order = ['user', 'feedback', 'project', 'reference', 'index'];
  const sumItems = order.filter(k => counts[k]).map(k => {
    const st = MEM_STYLE[k];
    const label = k === 'index' ? '색인' : (MEM_TYPE[k] || k);
    return `<span class="mem-sum" style="--c:${st.color}">${st.icon} ${label} ${counts[k]}</span>`;
  }).join('');
  const summary = sumItems ? `<div class="mem-summary">${sumItems}</div>` : '';

  const blocks = rows.map(r => {
    const cards = r.files.map(f => {
      const k = memKind(f);
      const st = MEM_STYLE[k];
      const label = k === 'index' ? '색인' : (MEM_TYPE[f.type] || f.type);
      const desc = memTr[f.name] || f.description || '';
      const size = fmtKB(f.size);
      return `<div class="mem-card" style="--c:${st.color}">
        <div class="mem-card-head">
          <span class="mem-ic">${st.icon}</span>
          <span class="mem-name">${esc(f.name)}</span>
          <span class="mem-type">${esc(label)}</span>
        </div>
        ${desc ? `<div class="mem-desc">${esc(desc)}</div>` : ''}
        ${size ? `<div class="mem-size">${esc(size)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="src-block">
      <div class="src-head"><b>📁 ${esc(r.project)}</b> <small>· ${r.files.length}개</small></div>
      <div class="mem-grid">${cards}</div>
    </div>`;
  }).join('');

  document.getElementById('panel-memory').innerHTML = intro + summary + (blocks || '<p>메모리 없음</p>');
}
```

- [ ] **Step 3: `styles.css`에 메모리 카드·요약 규칙 추가**

`public/styles.css`의 `/* ---------- Source blocks (mcp/skills/memory/install) ---------- */` 섹션 끝(현재 `.kv > span:first-child { ... }` 줄, 138행) 바로 다음 줄에 아래 블록을 추가한다.

```css
/* ---------- Memory cards ---------- */
.mem-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.mem-sum {
  font-size: 12px; font-weight: 600; color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  padding: 5px 11px; border-radius: 999px;
}
.mem-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.mem-card {
  position: relative; overflow: hidden;
  background: linear-gradient(180deg, var(--panel), var(--bg-2));
  border: 1px solid var(--line); border-radius: 12px;
  padding: 12px 14px 12px 16px; box-shadow: var(--shadow);
  transition: transform .12s, border-color .12s;
}
.mem-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c); }
.mem-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--c) 50%, var(--line)); }
.mem-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.mem-ic { width: 22px; height: 22px; flex: none; border-radius: 6px; display: grid; place-items: center; font-size: 12px; background: color-mix(in srgb, var(--c) 18%, transparent); }
.mem-name { flex: 1; min-width: 0; font-weight: 650; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mem-type { flex: none; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); padding: 2px 8px; border-radius: 999px; }
.mem-desc { color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.mem-size { color: var(--faint); font-size: 10.5px; margin-top: 7px; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: 브라우저에서 메모리 탭 검증**

Run: 브라우저 새로고침 후 좌측 "메모리" 메뉴 클릭.
확인:
- 인트로 문구 아래에 유형별 개수 요약 칩(예: `👤 사용자 N · 💬 피드백 N · 📌 프로젝트 N · …`)이 각 유형 색으로 보인다.
- 프로젝트별로 `📁 프로젝트명 · N개` 헤더 + 카드 그리드가 보인다.
- 각 카드에 좌측 색 띠 + 아이콘 + 파일명 + 유형 라벨 칩 + 설명 + 크기(KB)가 보인다.
- 유형 색이 매핑대로다: 사용자=파랑, 피드백=노랑, 프로젝트=보라, 참고=초록, MEMORY.md=회색(색인).

Expected: 위 항목 정상. 콘솔 에러 없음. (테스트 환경에 메모리가 없으면 "메모리 없음" 표시.)

- [ ] **Step 5: 커밋**

```bash
git add public/app.js public/styles.css
git commit -m "feat(ui): 메모리 탭을 유형별 색상 카드 그리드로 개선"
```

---

## Task 3: 반응형 + 회귀 검증

좁은 화면에서 사이드바가 상단 가로 스트립으로 접히게 하고, 자동화 테스트 회귀가 없음을 확인한다.

**Files:**
- Modify: `public/styles.css` (`@media` 규칙 추가)

- [ ] **Step 1: `styles.css` 맨 끝에 반응형 규칙 추가**

`public/styles.css`의 파일 맨 끝(모달 섹션 다음)에 아래를 추가한다.

```css
/* ---------- Responsive ---------- */
@media (max-width: 760px) {
  #layout { grid-template-columns: 1fr; }
  #sidebar {
    position: static; height: auto; flex-direction: row; flex-wrap: wrap;
    align-items: center; gap: 10px;
  }
  #nav { flex-direction: row; flex-wrap: wrap; }
  .sidebar-foot { margin-top: 0; margin-left: auto; }
}
```

- [ ] **Step 2: 브라우저에서 반응형 검증**

브라우저 창 폭을 760px 이하로 줄이거나(또는 F12 → 기기 툴바) 확인:
- 사이드바가 상단 가로 스트립으로 바뀐다(브랜드 + 메뉴가 가로 배치, 메뉴는 필요 시 줄바꿈).
- 본문이 전체 폭을 쓴다.
- 창을 다시 넓히면 좌측 사이드바로 복귀한다.

Expected: 위 항목 정상.

- [ ] **Step 3: 자동화 테스트 회귀 확인**

Run: `npm test`
Expected: 기존 모든 테스트 통과(`src/` 미변경이므로 PASS). 실패 시 변경이 의도치 않게 무언가를 건드린 것 — 중단하고 원인 조사.

- [ ] **Step 4: 커밋**

```bash
git add public/styles.css
git commit -m "feat(ui): 좁은 화면에서 사이드바 가로 접힘(반응형)"
```

---

## 완료 기준

- 좌측 사이드바에서 메뉴를 클릭해 모든 패널(세션/MCP/스킬/메모리/설치)을 전환할 수 있고, 현재 메뉴가 강조된다.
- 메모리 탭이 유형별 색상 카드 그리드 + 개수 요약으로 표시된다.
- 좁은 화면에서 사이드바가 상단으로 접힌다.
- `npm test` 전부 통과.
- 브라우저 콘솔에 에러 없음.
