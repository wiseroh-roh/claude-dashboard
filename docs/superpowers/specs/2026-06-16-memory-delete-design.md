# 메모리 삭제(휴지통 이동) — 설계

**날짜:** 2026-06-16
**대상:** `claude-dashboard` (`src/` + `public/`)
**범위:** 메모리 상세 모달에서 메모리 파일 하나를 "삭제"(= 휴지통으로 이동, 복구 가능)한다.

## 배경

메모리 카드를 클릭하면 상세 모달(`#mem-modal`)에서 파일 원문을 볼 수 있다(메모리 뷰어 기능).
이 모달에 삭제 기능을 추가한다. 세션 삭제(`moveSessionToTrash` + `DELETE /api/sessions/:id`)와
동일한 패턴 — 영구 삭제가 아니라 휴지통으로 이동해 되돌릴 수 있게 한다.

메모리 파일은 `~/.claude/projects/<project>/memory/<name>`에 있다.

## 목표

- 메모리 모달에서 파일 하나를 휴지통으로 이동(확인 단계 필수). 이동 후 목록에서 사라진다.

## 결정 사항(확정)

- **삭제 의미:** 휴지통 이동(복구 가능). 세션 삭제와 동일.
- **휴지통 위치:** `~/.claude/.trash/memory/`. 이동 파일명: `<project>__<timestamp>__<name>`
  (원래 `.md` 확장자가 끝에 남아 알아보기 쉬움). `timestamp`는 `Date.now()` 밀리초.
- **UI 진입점:** 메모리 모달 안의 위험색 버튼. 2단계 확인.
- **엔드포인트:** `DELETE /api/memory/file?project=<p>&name=<n>` (뷰어 GET과 같은 URL, 메서드만 다름).
- **MEMORY.md(인덱스)도 삭제 가능** — 특별 제한 없음.

## 비목표(YAGNI)

- 휴지통 복구 UI, 휴지통 비우기, 일괄 삭제, 영구 삭제 옵션.

## 아키텍처

### 1. 액션 모듈 (신규) — `src/actions/deleteMemory.js`

파일 시스템만 의존하는 순수 함수. `moveSessionToTrash`/`readMemoryFile`와 동일한 검증 스타일.

```
moveMemoryToTrash({ projectsDir, trashDir, project, name, now }) -> { trashedTo }
```

- `name` 검증: `/`, `\`, `..` 포함 시 `Error`(code `EOUTSIDE`) throw.
- 경로 해석: `path.resolve(path.join(projectsDir, project, 'memory', name))`가
  `path.resolve(projectsDir)` 하위가 아니면 `EOUTSIDE` throw (project 탈출도 방어).
- 파일이 없으면 `Error`(code `ENOENT`) throw.
- `fs.mkdirSync(trashDir, { recursive: true })` 후 대상 경로:
  `path.join(trashDir, sanitize(project) + '__' + now + '__' + sanitize(name))`.
  `sanitize`는 `[^A-Za-z0-9._-]`를 `-`로 치환(`.` 허용 → `.md` 보존).
- `fs.renameSync`로 이동. `{ trashedTo }` 반환.

### 2. 설정 — `src/config.js`

- `MEMORY_TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'memory')` 추가
  (세션의 `TRASH_DIR = .trash/sessions`와 대칭). 테스트에서 임시 경로로 덮어쓸 수 있게 config 키로 노출.

### 3. 서버 라우팅 — `src/server.js`

기존 `GET /api/memory/file` 라우트 블록 안에서, 또는 그 앞에 메서드 분기를 추가한다.

- `if (p === '/api/memory/file')` 블록 진입 후 가장 먼저 메서드 확인:
  - `project`/`name` 둘 중 하나라도 없으면 400.
  - `req.method === 'DELETE'`이면:
    `moveMemoryToTrash({ projectsDir: config.PROJECTS_DIR, trashDir: config.MEMORY_TRASH_DIR, project, name, now: Date.now() })`
    → 성공 `{ ok: true, trashedTo }`(200), `EOUTSIDE`→400, `ENOENT`→404, 그 외 500.
  - 그 외(GET)는 기존 동작: `readMemoryFile` → `{ project, name, content }`.
- 구현 메모: 인자 검증(400)은 GET/DELETE 공통이므로 한 번만 수행한 뒤 메서드로 분기한다.

### 4. 프론트엔드 — `public/index.html`, `public/app.js`, `public/styles.css`

- **index.html:** `#mem-modal`의 `.modal-body` 안 `<pre id="mem-content">` 다음에 액션 영역 추가:
  ```html
  <div id="mem-modal-actions">
    <button id="mem-delete" class="btn-danger">메모리 삭제</button>
  </div>
  ```
- **app.js `openMemoryModal(project, name)`:** 현재 메모리를 `currentMemory = { project, name }`에 저장하고,
  모달 열 때 삭제 버튼을 기본 상태로 리셋(`resetMemDeleteUI()`).
- **삭제 흐름(2단계, 메모리 모달 내부):** 세션 모달 흐름을 메모리용으로 병렬 작성.
  - `resetMemDeleteUI()`: `#mem-modal-actions`를 기본 버튼으로. 클릭 → `confirmMemDeleteUI()`.
  - `confirmMemDeleteUI()`: "정말 삭제? [취소][휴지통으로 이동]". 취소 → reset, 확인 → `doMemDelete()`.
  - `doMemDelete()`: `fetch('/api/memory/file?project=&name=', { method:'DELETE' })`. 성공 →
    `#mem-modal` 닫기 + `renderMemory()` 재호출(목록 갱신). 실패 → 액션 영역에 빨간 에러 텍스트.
- **닫기:** 기존 메모리 모달 닫기 핸들러 그대로(✕ / 배경 클릭).
- **styles.css:** 기존 `.btn-danger`/`.btn-ghost`/`.confirm-text`/`.error-text` 재사용.
  `#mem-modal-actions`는 세션의 `#modal-actions`와 동일 스타일을 공유하도록 선택자에 추가.

> 세션 모달(`#modal-actions`, `currentSessionId`)과 메모리 모달(`#mem-modal-actions`, `currentMemory`)은
> 내용·대상이 달라 흐름 함수를 병렬로 둔다. 소폭 중복은 가독성을 위해 허용한다(과한 일반화는 YAGNI).

## 데이터 흐름

```
메모리 모달 "메모리 삭제" → 확인 → DELETE /api/memory/file?project&name
  → 서버: 인자 검증 → moveMemoryToTrash (이름 검증 → projectsDir 하위 확인 → trash 이동)
  → 200 { ok, trashedTo }
프론트: #mem-modal 닫기 + renderMemory() → 카드 제거
```

## 에러 처리

| 상황 | 서버 | 프론트 |
|------|------|--------|
| project/name 누락 | 400 | 에러 텍스트 |
| name에 `/`·`\`·`..` | 400 | 에러 텍스트 |
| 파일 없음 | 404 | 에러 텍스트 |
| 이동 실패 | 500 + message | 에러 텍스트 |
| 정상 | 200 {ok, trashedTo} | 모달 닫기 + 목록 갱신 |

## 테스트 (`node --test`에 추가)

- **`test/deleteMemory.test.js`** (신규):
  - 임시 디렉터리에 `projects/p/memory/a.md` 생성 → `moveMemoryToTrash` → 원본 사라지고
    `trashDir`에 `p__<ts>__a.md` 생성됨 확인.
  - `name: '../../secret.md'` → `EOUTSIDE` throw.
  - 없는 파일 → `ENOENT` throw.
- **`test/server.test.js`** (확장):
  - 픽스처를 임시 복제한 디렉터리에 대해 `DELETE /api/memory/file?project=proj-a&name=some-fact.md`
    → 200 `{ok:true}`, 파일이 휴지통으로 이동, 이후 `GET /api/memory`에서 해당 프로젝트 파일 목록에서 사라짐.
  - `DELETE ...&name=../../etc` → 400.
  - `DELETE ...&name=nope.md` → 404.

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `src/actions/deleteMemory.js` | 신규 — `moveMemoryToTrash` 순수 함수 |
| `src/config.js` | `MEMORY_TRASH_DIR` 추가 |
| `src/server.js` | `/api/memory/file`에 DELETE 분기 추가 |
| `public/index.html` | `#mem-modal`에 `#mem-modal-actions` + 삭제 버튼 |
| `public/app.js` | `currentMemory` 추적 + 메모리 모달 2단계 삭제 흐름 |
| `public/styles.css` | `#mem-modal-actions`를 기존 액션 스타일에 포함 |
| `test/deleteMemory.test.js` | 신규 단위 테스트 |
| `test/server.test.js` | `DELETE /api/memory/file` 테스트 추가 |
