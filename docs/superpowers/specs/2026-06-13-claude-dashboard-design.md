# Claude Dashboard — 설계 문서

**날짜:** 2026-06-13
**상태:** 승인됨 (구현 계획 작성 단계로 진행)

## 1. 목적

로컬 `~/.claude` 디렉토리의 데이터를 읽어 Claude Code의 현재 상태를 모니터링·시각화하는 대시보드. 세션, MCP 서버, 스킬/플러그인, 메모리, 작업(Task)을 한 화면에서 관찰한다. **읽기 전용** — `~/.claude`를 절대 수정하지 않는다.

## 2. 기반 결정 (확정)

| 항목 | 결정 |
|---|---|
| 실행 방식 | 로컬 웹앱 + 주기적 폴링 (Node 백엔드 + 정적 프론트) |
| 범위 | 전체 프로젝트 통합 뷰 (프로젝트별 필터 가능) |
| 기술 스택 | 바닐라 JS + 경량 차트 라이브러리(Chart.js), 빌드 도구 없음 |
| 레이아웃 | B안 — 상단 KPI 바 + 카드 그리드 + 탭(세션/MCP/스킬/메모리) |
| 갱신 주기 | 기본 5초 폴링 (설정 가능) |

## 3. 데이터 소스 (확인 완료)

| 소스 | 경로 | 제공 데이터 |
|---|---|---|
| 세션 트랜스크립트 | `~/.claude/projects/<encoded>/*.jsonl` | 턴, `usage`(input/output/cache 토큰), 모델, 타임스탬프, 오류 마커 |
| 세션 도구 통계 | `~/.claude/.session-stats.json` | 세션별 도구 호출 집계, `started_at`/`updated_at`, `total_calls`, `last_tool` |
| MCP 서버 | `~/.claude.json`, `~/.claude/mcp-needs-auth-cache.json` | MCP 서버 목록·인증 상태 |
| 스킬/플러그인 | `~/.claude/plugins/` | 설치된 스킬·플러그인 |
| 메모리 | `~/.claude/projects/<encoded>/memory/` | 메모리 파일 목록·요약 |
| 작업(Task) | `~/.claude/tasks/` | 작업 상태 |

## 4. 아키텍처 & 데이터 흐름

```
~/.claude/  ──읽기전용──▶  Node 백엔드  ──HTTP/JSON──▶  브라우저
  projects/*/*.jsonl          ├ 5초 주기 캐시 갱신          (바닐라 JS + Chart.js)
  .session-stats.json         └ mtime이 바뀐 세션만 증분 파싱   └ 5초 폴링으로 KPI·카드 갱신
  .claude.json / mcp-cache
  plugins/ , tasks/ , memory/
```

- **읽기 전용** 보장: 파일을 열고 읽기만 한다.
- **증분 파싱**: 매 폴링마다 전체 JSONL 재파싱은 비효율 → 파일 `mtime`이 바뀐 세션만 다시 파싱하고 결과를 메모리에 캐시.
- **프론트 폴링**: 기본 5초, 설정으로 조정 가능.

## 5. 모듈 구성

각 모듈은 단일 책임을 가지며 독립적으로 테스트 가능하다.

| 모듈 | 책임 | 입력 → 출력 |
|---|---|---|
| `sources/sessions.js` | JSONL 트랜스크립트 파싱 | 파일 → {턴, usage, 모델, 타임스탬프, 오류} |
| `sources/sessionStats.js` | `.session-stats.json` 읽기 | → 세션별 도구 호출 집계 |
| `sources/mcp.js` | `.claude.json` + auth 캐시 | → MCP 서버 목록·인증 상태 |
| `sources/skills.js` | `plugins/` 스캔 | → 설치 스킬·플러그인 |
| `sources/memory.js` | `projects/*/memory/` 스캔 | → 메모리 파일 목록·요약 |
| `sources/tasks.js` | `tasks/` 디렉토리 스캔 | → 작업 상태 |
| `metrics/aggregate.js` | KPI·비용·지연·상태 계산 | 위 소스 → 대시보드 모델 |
| `server.js` | HTTP 서버, API 라우트, 캐시 루프 | — |
| `public/` | UI (index.html, app.js, charts) | — |

### API 엔드포인트

- `GET /api/overview` — KPI 요약
- `GET /api/sessions` — 세션 카드 목록 (프로젝트 필터 쿼리 지원)
- `GET /api/sessions/:id` — 세션 상세 (턴 타임라인·도구·토큰 추이)
- `GET /api/mcp` — MCP 서버 목록·상태
- `GET /api/skills` — 스킬/플러그인 목록
- `GET /api/memory` — 메모리 파일 목록

## 6. 지표 정의

### 6.1 세션 상태 점 (휴리스틱)

파일만으로는 정확한 상태 판단이 불가능하므로 다음 휴리스틱을 사용한다. 임계값은 설정 파일로 조정 가능.

| 점 | 상태 | 조건 |
|---|---|---|
| 🟢 | 실행중 | 마지막 활동(`updated_at`/파일 mtime)이 60초 이내 |
| 🟡 | 대기 | 마지막 항목이 어시스턴트 응답(사용자 입력 대기), 활동 60초~30분 |
| ⚪ | 완료/유휴 | 활동 30분 초과 |
| 🔴 | 오류 | 마지막 트랜스크립트에 오류 마커(`is_error` tool_result 등) 존재 |

기본 임계값: 실행중 = 60초, 유휴 전환 = 30분.

### 6.2 추정 비용

- 모델별 단가표 `pricing.json` (사용자가 직접 수정). 키: 모델 ID(opus/sonnet/haiku 등).
- 비용 = `input·output·cache_creation·cache_read` 토큰 각각에 해당 단가 적용 후 합산.
- 모델 ID는 트랜스크립트의 assistant 메시지에서 추출.
- **주의:** 단가표는 사용자가 직접 관리해야 한다 (API가 단가를 제공하지 않음). UI에 "추정치" 명시.

### 6.3 기타 지표

- **평균 응답 시간**: 사용자 메시지 → 다음 어시스턴트 완료까지 타임스탬프 차이의 평균.
- **KPI 바**: 전체 세션 수 · 실행 중 세션 · 누적 턴 수 · 입력/출력 토큰 · 평균 응답 시간 · 추정 비용.

## 7. UI — 레이아웃 B

- **상단 KPI 바**: §6.3 지표.
- **탭 네비게이션**: `세션` | `MCP` | `스킬` | `메모리`
  - **세션 탭**: 세션 카드 그리드(상태 점·턴·토큰·마지막 지연시간), 프로젝트 필터. 카드 클릭 시 상세 모달(턴 타임라인·도구 사용·토큰 추이 차트).
  - **MCP 탭**: MCP 서버 목록 + 인증 상태.
  - **스킬 탭**: 설치된 스킬/플러그인 목록.
  - **메모리 탭**: 메모리 파일 목록·요약.
- **차트(Chart.js)**: 토큰 추이, 응답시간 분포.

## 8. 오류 처리

- 손상된 JSONL 라인은 건너뛰고 로그에 남긴다.
- 누락된 파일/디렉토리는 빈 데이터로 graceful 처리.
- 한 소스의 실패가 전체 대시보드를 막지 않는다 (소스별 독립 처리).

## 9. 테스트 전략

- 각 `sources/*` 파서를 실제 JSONL 일부를 픽스처로 단위 테스트.
- `metrics/aggregate`는 합성 입력으로 검증.
- TDD로 진행 (구현 전 테스트 작성).

## 10. 비범위 (YAGNI)

- 데스크톱 앱 패키징 (Electron) — 제외.
- 실시간 WebSocket 푸시 — 폴링으로 충분.
- `~/.claude` 데이터 편집/관리 기능 — 모니터링 전용.
- 인증/멀티유저 — 로컬 단일 사용자 전제.
