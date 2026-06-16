# Claude Dashboard

로컬 `~/.claude` 디렉터리를 읽어 **Claude Code의 상태를 한눈에 보여주는 웹 대시보드**입니다.
세션 활동·토큰·비용, MCP 서버, 설치된 스킬, 프로젝트별 장기 메모리, 설치/플러그인 정보를
브라우저에서 실시간(5초 폴링)으로 확인할 수 있습니다.

기본은 **모니터링(읽기) 도구**이며, 추가로 세션과 메모리 파일을 **휴지통으로 이동하는
방식의 삭제(복구 가능)**를 지원합니다. 서버는 `127.0.0.1`(로컬 전용)에만 바인딩됩니다.

---

## 빠른 시작

```bash
npm install      # 런타임 의존성 없음 (package-lock.json만 생성)
npm start        # → http://localhost:7878
```

브라우저에서 `http://localhost:7878` 을 엽니다.

- **요구사항:** Node.js 18 이상 (내장 테스트 러너 `node --test` 사용).
- **외부 의존성 없음:** 서버는 Node 기본 모듈만 사용합니다. 세션 상세의 도구 사용량 차트는
  Chart.js를 CDN으로 불러오므로, 그 차트를 보려면 인터넷 연결이 필요합니다(나머지는 오프라인 동작).

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `7878` | 서버 포트 |
| `POLL_MS` | `5000` | 데이터 갱신 주기(ms) |
| `CLAUDE_DIR` | `~/.claude` | 데이터를 읽을 Claude 디렉터리 |
| `CLAUDE_JSON` | `~/.claude.json` | MCP 서버 설정 파일 경로 |

```bash
PORT=8473 POLL_MS=3000 CLAUDE_DIR=/custom/.claude npm start
```

> **Windows 참고:** 기본 포트 `7878`이 Hyper-V 예약 범위와 충돌할 수 있습니다.
> 시작 시 `EACCES` 오류가 나면 다른 포트를 쓰세요. 예: `PORT=8473 npm start`

---

## 화면 구성 및 사용법

### 좌측 사이드바
- 상단 브랜드, 가운데 메뉴(세션 / MCP / 스킬 / 메모리 / 설치), 하단 실시간 표시.
- 현재 선택한 메뉴가 보라색으로 강조됩니다.
- 화면 폭이 좁으면(≤ 760px) 사이드바가 상단 가로 메뉴로 접힙니다.

### 상단 KPI 바
전체 세션 / 실행 중 / 누적 턴 / 입력 토큰 / 출력 토큰 / 평균 응답 시간 / 추정 비용을 보여줍니다.

### 세션 탭
- 세션마다 카드 1개. 상태 점(🟢 실행중 / 🟡 대기 / ⚪ 유휴 / 🔴 오류), 턴 수, 토큰, 지연, 추정 비용 표시.
- 상단의 **프로젝트** 드롭다운으로 필터링.
- 카드를 **클릭**하면 상세 모달이 열려 모델·턴·비용·상태와 **도구 사용량 차트**를 보여줍니다.
- 상세 모달 하단의 **"세션 삭제"** 버튼으로 세션을 휴지통으로 이동할 수 있습니다(아래 *삭제 기능* 참고).

### MCP 탭
설정된 MCP(Model Context Protocol) 서버 목록과 상태(🟢 사용 가능 / 🟡 인증 필요 / ⚪ 설정됨), 한글 설명을 표로 보여줍니다.

### 스킬 탭
설치된 플러그인과 각 플러그인이 제공하는 스킬 목록(활성/비활성 + 설명)을 보여줍니다.

### 메모리 탭
- 프로젝트별 장기 메모리를 **유형별 색상 카드 그리드**로 보여줍니다.
  유형: 👤 사용자(파랑) · 💬 피드백(노랑) · 📌 프로젝트(보라) · 🔗 참고(초록) · 🗂️ 색인(회색, `MEMORY.md`).
- 상단에 유형별 개수 요약 칩이 표시됩니다.
- 카드를 **클릭**하면 모달에서 파일 **원문**을 그대로(monospace) 볼 수 있습니다.
- 모달 하단의 **"메모리 삭제"** 버튼으로 해당 메모리 파일을 휴지통으로 이동할 수 있습니다.

### 설치 탭
Claude Code 본체 버전·설치 방식·실행 횟수·업데이트 상태와, 설치된 플러그인·마켓플레이스 목록을 보여줍니다.

---

## 세션 상태 판정 기준

API에 "실행 중" 신호가 없어 **파일 활동 시각**으로 상태를 추정합니다.

| 상태 | 조건 |
|------|------|
| 🟢 실행중 | 마지막 활동이 최근 60초 이내 |
| 🟡 대기 | 마지막 활동이 60초 ~ 30분 |
| ⚪ 유휴 | 마지막 활동이 30분 초과 |
| 🔴 오류 | 세션의 **가장 최근** 도구 결과가 오류 (이후 회복되면 오류로 보지 않음) |

임계값은 `src/config.js`의 `RUNNING_THRESHOLD_MS`, `IDLE_THRESHOLD_MS`에서 조정합니다.

---

## 삭제 기능 (휴지통 이동, 복구 가능)

세션과 메모리는 **영구 삭제가 아니라 휴지통 폴더로 이동**합니다. 모달 안에서 2단계 확인을 거칩니다.

| 대상 | 위치 | 휴지통 |
|------|------|--------|
| 세션 | `~/.claude/projects/<프로젝트>/<sessionId>.jsonl` | `~/.claude/.trash/sessions/<프로젝트>__<sessionId>__<타임스탬프>.jsonl` |
| 메모리 | `~/.claude/projects/<프로젝트>/memory/<파일명>` | `~/.claude/.trash/memory/<프로젝트>__<타임스탬프>__<파일명>` |

- **복구:** 휴지통의 파일을 원래 폴더로 다시 옮기면 됩니다. (세션은 `.session-stats.json`·`tasks/`를,
  메모리는 다른 파일을 건드리지 않으므로 복구 시 함께 살아납니다.)
- **영향 범위:** 이 파일들은 Claude Code의 **실제 로컬 기록**입니다. 세션을 삭제하면
  `claude --resume` 목록에서 사라지고, 메모리를 삭제하면 Claude가 더는 그 사실을 기억하지 않습니다.
  단, **claude.ai 웹/계정 등 서버 쪽에는 영향이 없습니다**(모두 로컬 파일).
- **주의:** 지금 **실행 중인 세션**을 삭제하면 Claude Code가 그 파일에 쓰는 중이라 꼬일 수 있으니,
  끝난 세션을 삭제하는 것이 안전합니다.

---

## 비용 추정

`src/pricing.json`에 모델별 100만 토큰당 USD 단가가 들어 있습니다. API가 단가를 제공하지 않아
**추정치**이며, 실제 요금에 맞게 이 파일을 수정하면 됩니다.

---

## 읽는 데이터 (경로)

모두 `~/.claude` 하위(또는 `~/.claude.json`)에서 읽습니다.

| 데이터 | 경로 |
|--------|------|
| 세션 트랜스크립트 | `~/.claude/projects/<프로젝트>/<sessionId>.jsonl` |
| 세션 통계(도구 사용량) | `~/.claude/.session-stats.json` |
| 메모리 | `~/.claude/projects/<프로젝트>/memory/*.md` |
| MCP 서버 | `~/.claude.json`, `~/.claude/mcp-needs-auth-cache.json` |
| 스킬/플러그인 | `~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json` |
| 마켓플레이스 | `~/.claude/plugins/known_marketplaces.json` |
| 설치/업데이트 | `~/.claude/.last-update-result.json` |

> 표시는 한국어 우선입니다. `public/translations-ko.json`이 MCP·스킬·메모리 설명을 한글로
> 덮어쓰며(원본 데이터는 그대로), 번역이 없으면 원문을 표시합니다.

---

## API 엔드포인트 (참고)

| 메서드 · 경로 | 설명 |
|------|------|
| `GET /api/overview` | KPI 요약 |
| `GET /api/sessions[?project=]` | 세션 카드 목록 |
| `GET /api/sessions/:id` | 세션 상세 + 도구 사용량 |
| `DELETE /api/sessions/:id` | 세션을 휴지통으로 이동 |
| `GET /api/mcp` | MCP 서버 목록 |
| `GET /api/skills` | 플러그인·스킬 목록 |
| `GET /api/memory` | 프로젝트별 메모리 목록 |
| `GET /api/memory/file?project=&name=` | 메모리 파일 원문 |
| `DELETE /api/memory/file?project=&name=` | 메모리 파일을 휴지통으로 이동 |
| `GET /api/tasks` | 태스크 목록 |
| `GET /api/install` | Claude Code·플러그인·마켓플레이스 설치 정보 |

---

## 테스트

```bash
npm test         # node --test
```

서버 라우팅, 데이터 파서, 메트릭, 삭제 액션 등을 다룹니다(현재 56개 통과).
프론트엔드(`public/`)는 별도 단위 테스트 하네스 없이 브라우저에서 수동 검증합니다.

---

## 프로젝트 구조

```
src/
  server.js          HTTP 서버 + 라우팅
  cache.js           트랜스크립트 → 카드/개요 스냅샷 (5초 갱신)
  config.js          경로·포트·임계값 설정
  pricing.json       모델별 토큰 단가(추정)
  sources/           데이터 소스 (sessions, mcp, skills, memory, memoryFile, tasks, install, ...)
  metrics/           집계·비용·상태 계산
  actions/           deleteSession, deleteMemory (휴지통 이동)
public/
  index.html         레이아웃 (사이드바 + 본문 + 모달)
  app.js             데이터 fetch·렌더·상호작용
  styles.css         다크 테마 스타일
  translations-ko.json  한글 표시 번역 레이어
test/                node --test 테스트 + 픽스처
docs/superpowers/    기능별 설계(specs)·구현 계획(plans) 문서
```

## 라이선스

MIT
