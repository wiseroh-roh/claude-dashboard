# 메모리 파일 상세 레이어 — 설계

**날짜:** 2026-06-15
**대상:** `claude-dashboard` (`src/` + `public/`)
**범위:** 메모리 카드를 클릭하면 모달(상세 레이어)에서 파일 원문을 볼 수 있게 한다. 보기 전용.

## 배경

메모리 탭은 프로젝트별 메모리 파일을 색상 카드 그리드로 보여준다(이름·유형·설명·크기). 하지만
카드를 눌러도 **파일 내용은 볼 수 없다** — `/api/memory`는 메타데이터만 반환하기 때문이다.
메모리 파일은 `~/.claude/projects/<project>/memory/<name>`에 있는 마크다운(`---` 프론트마터 +
본문 + `[[링크]]`)이다.

## 목표

- 메모리 카드 클릭 → 모달에서 해당 파일의 **원문**(monospace)을 그대로 표시.

## 결정 사항(확정)

- **표시 방식:** 원문 그대로(monospace). 마크다운 렌더링 없음(의존성 추가 안 함).
- **상세 레이어:** 세션 모달과 같은 `.modal` 오버레이를 재사용하는 **별도 모달** `#mem-modal`.
- **엔드포인트:** `GET /api/memory/file?project=<p>&name=<n>`.

## 비목표(YAGNI)

- 편집/저장, 마크다운 렌더링, `[[링크]]` 클릭 이동, 검색. (보기 전용)

## 아키텍처

### 1. 소스 모듈 (신규) — `src/sources/memoryFile.js`

파일 시스템만 의존하는 순수 함수. HTTP는 모른다.

```
readMemoryFile({ projectsDir, project, name }) -> { content }
```

- `name` 검증: `/`, `\`, `..`가 포함되면 `Error`(code `EOUTSIDE`) throw. (파일명만 허용)
- 경로 해석: `path.join(projectsDir, project, 'memory', name)`. `path.resolve`한 값이
  `path.resolve(projectsDir)` 하위가 아니면 `EOUTSIDE` throw (이중 방어).
- 파일이 없으면 `Error`(code `ENOENT`) throw.
- `fs.readFileSync(file, 'utf8')`로 읽어 `{ content }` 반환.

### 2. 서버 라우팅 — `src/server.js`

GET 라우트 추가(기존 `/api/memory` 위/아래 어디든, `/api/memory/file`을 명시적으로 먼저 매칭).

- `if (p === '/api/memory/file')`:
  1. `project = url.searchParams.get('project')`, `name = url.searchParams.get('name')`.
  2. 둘 중 하나라도 없으면 `sendJson(res, 400, { error: 'project and name required' })`.
  3. `readMemoryFile({ projectsDir: config.PROJECTS_DIR, project, name })` 호출.
  4. 성공 → `sendJson(res, 200, { project, name, content })`.
  5. `EOUTSIDE` → 400, `ENOENT` → 404, 그 외 → 500 `{ error }`.
- 주의: 기존 `/api/memory`(목록) 라우트와 충돌하지 않도록 `/api/memory/file`을 먼저 정확히 매칭한다.

### 3. 프론트엔드 — `public/index.html`, `public/app.js`, `public/styles.css`

- **index.html:** 기존 세션 `#modal` 다음에 메모리 모달 추가:
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
- **app.js `renderMemory`:** 각 `.mem-card`에 클릭 가능 표시(`data-project`/`data-name`)를 넣고,
  렌더 후 카드에 `onclick`을 바인딩해 `openMemoryModal(project, name)`을 호출한다.
  (이름/프로젝트는 카드 생성 시점에 알고 있으므로 data 속성으로 전달.)
- **app.js `openMemoryModal(project, name)`:**
  1. `GET /api/memory/file?project=&name=` fetch.
  2. 실패(`!r.ok`) → 제목에 파일명, `#mem-content`에 빨간 에러 텍스트 표시 후 모달 표시.
  3. 성공 → 제목=파일명, 메타=`프로젝트: <project>`(유형·크기는 이미 카드에 보이므로 제외 →
     시그니처는 `openMemoryModal(project, name)`로 단순 유지), `#mem-content`에 `esc(content)` 표시. 모달 표시.
- **닫기 핸들러:** `#mem-modal-close` 클릭 / 배경 클릭 시 `#mem-modal`에 `hidden` 추가
  (세션 모달과 동일 패턴, 별도 핸들러).
- **styles.css:** `#mem-content`(monospace, `white-space: pre-wrap`, 최대 높이 + 스크롤,
  은은한 배경/보더). 기존 `.modal`/`.modal-body` 재사용.

## 데이터 흐름

```
mem-card 클릭 → openMemoryModal(project, name)
  → GET /api/memory/file?project&name
  → 서버: readMemoryFile (이름 검증 → projectsDir 하위 확인 → 읽기)
  → 200 { project, name, content }
프론트: #mem-modal에 원문 표시
```

## 에러 처리

| 상황 | 서버 | 프론트 |
|------|------|--------|
| project/name 누락 | 400 | 에러 텍스트 |
| name에 `/`·`\`·`..` | 400 | 에러 텍스트 |
| 파일 없음 | 404 | 에러 텍스트 |
| 읽기 실패 | 500 + message | 에러 텍스트 |
| 정상 | 200 {content} | 원문 표시 |

## 테스트 (`node --test`에 추가)

- **`test/memoryFile.test.js`** (신규):
  - 임시 디렉터리에 `projects/p/memory/a.md` 생성 → `readMemoryFile` → `{ content }`가 파일 내용과 일치.
  - `name: '../secret.md'` → `EOUTSIDE` throw.
  - 없는 파일 → `ENOENT` throw.
- **`test/server.test.js`** (확장):
  - `GET /api/memory/file?project=proj-a&name=some-fact.md` → 200, `content`에 파일 텍스트 포함.
    (픽스처 `proj-a/memory/some-fact.md`는 읽기 전용으로 사용 — 변형 없음)
  - `GET /api/memory/file?project=proj-a&name=../../etc` → 400.
  - `GET /api/memory/file?project=proj-a&name=nope.md` → 404.

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `src/sources/memoryFile.js` | 신규 — `readMemoryFile` 순수 함수 |
| `src/server.js` | `GET /api/memory/file` 라우트 |
| `public/index.html` | `#mem-modal` 추가 |
| `public/app.js` | 카드 클릭 바인딩 + `openMemoryModal` + 닫기 핸들러 |
| `public/styles.css` | `#mem-content` 스타일 |
| `test/memoryFile.test.js` | 신규 단위 테스트 |
| `test/server.test.js` | `/api/memory/file` 테스트 추가 |
