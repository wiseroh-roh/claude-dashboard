# 세션 삭제(휴지통 이동) — 설계

**날짜:** 2026-06-15
**대상:** `claude-dashboard` (`src/` + `public/`)
**범위:** 대시보드에서 세션 하나를 "삭제"(= 휴지통으로 이동, 복구 가능)하는 기능 추가.

## 배경

대시보드는 현재 명시적으로 **읽기 전용**이다. 한 "세션"은 디스크의
`~/.claude/projects/<project>/<sessionId>.jsonl` 트랜스크립트 파일 하나이며,
`src/cache.js`는 파일이 사라지면 다음 새로고침(5초) 때 목록에서 자동으로
제외한다. 따라서 삭제 기능은 "파일을 옮기는 쓰기 동작 + UI"만 추가하면 된다.

세션 `.jsonl`은 Claude Code의 실제 대화 기록이라 영구 삭제는 위험하다. 그래서
**영구 삭제가 아니라 휴지통(보관 폴더)으로 이동**해 되돌릴 수 있게 한다.

## 목표

- 상세 모달에서 세션 하나를 휴지통으로 이동(확인 단계 필수).
- 이동 후 대시보드 목록에서 사라지고, 디스크의 휴지통 폴더에 보존된다.

## 결정 사항(확정)

- **삭제 의미:** 휴지통 이동(복구 가능). 영구 삭제 아님.
- **무엇을 이동:** 세션 `.jsonl` 파일만. `.session-stats.json`·`tasks/<id>/`는
  건드리지 않는다(복구 시 통계·태스크가 함께 살아남).
- **휴지통 위치:** `~/.claude/.trash/sessions/`. 이동 파일명은
  `<project>__<sessionId>__<timestamp>.jsonl`(충돌 방지 + 출처 보존).
  `timestamp`는 `Date.now()` 밀리초 정수.
- **UI 진입점:** 상세 모달 안의 위험색 버튼. 확인 단계 필수.
- **엔드포인트:** `DELETE /api/sessions/:id`.

## 비목표(YAGNI)

- 휴지통에서 되살리는 UI, 휴지통 비우기, 일괄 삭제, 영구 삭제 옵션. (필요 시 후속)

## 아키텍처

### 1. 액션 모듈 (신규) — `src/actions/deleteSession.js`

순수 함수. 파일 시스템만 의존하고 서버/HTTP는 모른다.

```
moveSessionToTrash({ file, projectsDir, trashDir, project, sessionId, now }) -> { trashedTo }
```

- `file`을 `path.resolve`한 값이 `path.resolve(projectsDir)` 하위인지 검증.
  아니면 `Error`(코드 `EOUTSIDE`)를 throw → 서버가 400으로 변환.
- `trashDir`를 `fs.mkdirSync(trashDir, { recursive: true })`로 보장.
- 대상 경로: `path.join(trashDir, sanitize(project) + '__' + sanitize(sessionId) + '__' + now + '.jsonl')`.
  `sanitize`는 경로 구분자/상위참조를 막기 위해 `[^A-Za-z0-9._-]`를 `-`로 치환.
- `fs.renameSync(file, dest)`로 이동. 성공 시 `{ trashedTo: dest }` 반환.
- 파일이 없으면 `Error`(코드 `ENOENT`)를 그대로 전파(서버가 404로 변환).

### 2. 캐시 확장 — `src/cache.js`

`refresh()`가 반환하는 스냅샷에 `files` 맵을 추가한다.

- 현재 스냅샷: `{ cards, overview }`.
- 변경 후: `{ cards, overview, files }`. `files`는 평범한 객체로
  `sessionId(card 기준) -> { file, project }`. 이미 `parsed`에는 파일별
  `summary`(sessionId 포함)가 있으므로, 그 file 키와 summary.sessionId로 맵을 만든다.
- 카드의 `sessionId`는 `.jsonl` 내부 값일 수 있어(파일명과 다를 수 있음)
  반드시 summary 기준으로 매핑한다(파일명 가정 금지).

### 3. 서버 라우팅 — `src/server.js`

메서드 인식 분기를 추가한다. 기존 GET 라우팅은 그대로 둔다.

- 현재 핸들러는 메서드를 보지 않는다. `req.method === 'DELETE'`이고
  `p`가 `/api/sessions/<id>` 형태이면 삭제 처리한다.
- 처리 절차:
  1. `id = decodeURIComponent(p.slice('/api/sessions/'.length))`.
  2. `entry = snapshot.files[id]`. 없으면 `sendJson(res, 404, { error: 'not found' })`.
  3. `moveSessionToTrash({ file: entry.file, projectsDir: config.PROJECTS_DIR,
     trashDir: config.TRASH_DIR, project: entry.project, sessionId: id, now: Date.now() })`.
  4. 성공 → `sendJson(res, 200, { ok: true, trashedTo })`. 즉시 `snapshot = cache.refresh()`로
     캐시를 갱신해 후속 GET에 반영.
  5. `EOUTSIDE` → 400, `ENOENT` → 404, 그 외 → 500 `{ error: message }`.
- 기존 GET `/api/sessions/:id`(상세)와 충돌하지 않도록 메서드로 구분한다.

### 4. 설정 — `src/config.js`

- `TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'sessions')` 추가.
- 테스트에서 임시 디렉터리로 덮어쓸 수 있도록 config 키로 노출(기존 패턴과 동일).

### 5. 프론트엔드 — `public/app.js`, `public/index.html`, `public/styles.css`

- **index.html:** 모달 `.modal-body`에 푸터 영역 추가:
  `<div id="modal-actions"><button id="session-delete" class="btn-danger">세션 삭제</button></div>`.
- **app.js `openModal(id)`:** 현재 열린 세션 id를 변수에 저장(`currentSessionId`).
  삭제 버튼을 기본 상태로 리셋.
- **삭제 흐름(2단계, 모두 모달 내부):**
  1. "세션 삭제" 클릭 → 버튼 영역을 확인 UI로 교체:
     "정말 삭제할까요? [취소] [휴지통으로 이동]".
  2. "취소" → 원래 버튼으로 복귀. "휴지통으로 이동" → `fetch('/api/sessions/' +
     encodeURIComponent(currentSessionId), { method: 'DELETE' })`.
  3. 응답 `ok` → 모달 닫기 + `refreshSessions()` 호출. 실패 → 확인 UI 자리에
     빨간 에러 텍스트 표시(모달 유지).
- **styles.css:** `.btn-danger`(빨강), `#modal-actions`(우측 정렬, 상단 구분선),
  확인 UI용 보조 스타일.

## 데이터 흐름 요약

```
모달 "삭제" → 확인 → DELETE /api/sessions/:id
  → 서버: snapshot.files[id]로 파일 경로 해석
  → moveSessionToTrash: projectsDir 하위 검증 → trashDir 생성 → rename
  → 200 {ok, trashedTo}; 서버 캐시 즉시 refresh
프론트: 모달 닫기 + refreshSessions → 목록에서 제거
```

## 에러 처리

| 상황 | 서버 응답 | 프론트 |
|------|-----------|--------|
| 없는 sessionId | 404 | 에러 텍스트 "세션을 찾을 수 없음" |
| 경로 탈출 검증 실패 | 400 | 에러 텍스트 |
| rename 실패(권한 등) | 500 + message | 에러 텍스트, 모달 유지 |
| 정상 | 200 {ok, trashedTo} | 모달 닫기 + 목록 갱신 |

서버는 `127.0.0.1` 바인딩(로컬 전용)이지만 경로 검증은 항상 수행한다.

## 테스트 (`node --test`에 추가)

- **`test/deleteSession.test.js`** (신규):
  - 임시 디렉터리에 `projects/p/x.jsonl` 생성 → `moveSessionToTrash` → 원본 사라지고
    `trashDir`에 `p__x__<ts>.jsonl` 생성됨을 확인.
  - `projectsDir` 밖 파일 경로 → `EOUTSIDE` throw 확인.
  - 없는 파일 → `ENOENT` throw 확인.
- **`test/server.test.js`** (확장):
  - 픽스처를 임시로 복제한 디렉터리에 대해 `DELETE /api/sessions/<id>` → 200 `{ok:true}`,
    파일이 휴지통으로 이동, 이후 GET `/api/sessions`에서 사라짐 확인.
  - `DELETE /api/sessions/없는id` → 404.
  - (기존 GET 테스트는 그대로 통과해야 함.)

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `src/actions/deleteSession.js` | 신규 — `moveSessionToTrash` 순수 함수 |
| `src/cache.js` | `refresh()` 스냅샷에 `files`(id→{file,project}) 맵 추가 |
| `src/server.js` | `DELETE /api/sessions/:id` 라우팅 + 삭제 후 캐시 refresh |
| `src/config.js` | `TRASH_DIR` 추가 |
| `public/index.html` | 모달에 `#modal-actions` + 삭제 버튼 |
| `public/app.js` | `currentSessionId` 추적, 2단계 삭제 흐름 |
| `public/styles.css` | `.btn-danger`·`#modal-actions`·확인 UI 스타일 |
| `test/deleteSession.test.js` | 신규 단위 테스트 |
| `test/server.test.js` | `DELETE` 엔드포인트 테스트 추가 |
