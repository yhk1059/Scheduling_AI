# 아키텍처

## 디렉토리 구조
```
app/                  # Next.js 페이지 (UI 세부는 UI_GUIDE 확정 후)
components/           # UI 컴포넌트
lib/
├── store.ts          # Zustand + persist(localStorage) — 유일한 저장소
├── api.ts            # /api/py/* fetch 래퍼
├── roster-import.ts  # 명단/이월 붙여넣기 파싱 (순수 함수)
├── csv.ts            # CSV 직렬화 (순수 함수)
├── types.gen.ts      # Pydantic JSON Schema에서 생성 (직접 수정 금지)
└── samples/ward-15.json
api/index.py          # Vercel Python 함수 진입점 (import만 함)
backend/              # FastAPI 앱 (무상태)
├── routes.py         # HTTP 계층, solver와 llm 오케스트레이션
├── domain/           # models.py (Pydantic, 단일 기준), constants.py (상한, 시간, 가중치)
├── solver/           # CP-SAT: model, hard, soft, stats, conflicts — llm을 import하지 않음
├── llm/              # client, translator, explainer, prompts, pseudonym — solver를 import하지 않음
├── gen_types.py      # JSON Schema → lib/types.gen.ts
└── tests/
eval/                 # dataset.jsonl, run.py, results.md
scripts/              # harness 전용 (앱 코드를 두지 않음)
```

## 패턴
- **역할 분리**: LLM은 자연어를 제약 스펙(템플릿 12개 중 선택 + 파라미터)으로 번역하고 충돌을 설명한다. 계산은 CP-SAT만 한다.
- **단일 스키마**: `backend/domain/models.py`가 다음의 단일 기준이다.
  - Claude tool `input_schema`
  - 입력 검증
  - 솔버 입력
  - TS 타입
- **LLM 출력 검증**: Pydantic 검증과 참조 무결성 검사를 거친 뒤에만 쓴다. 실패하면 오류를 넣어 최대 2회 재시도한다. 결과는 항상 "제안"이고, 사람이 [적용]하거나 서버가 재풀이로 검증해야 반영된다.
- **결정적 대체 경로**: explain이 실패해도 충돌 제약의 `source_text`와 [이번 달만 끄기]로 진행할 수 있다.
- **가명 처리**: LLM 호출 전에 간호사 이름을 `N01` 같은 가명으로 바꾸고, 응답에서 되돌린다.
- **수동 조정**: 칸 수정은 "고정 배정" 제약이 된다. 솔버 경로는 하나다.

## 데이터 흐름
```
규칙 입력:  UI → POST /api/py/translate → 가명 치환 → Claude(tool use) → Pydantic 검증(재시도 ≤2)
           → 제안 카드 → 사용자 [적용] → store

생성:      store 전체 → POST /api/py/solve → CP-SAT → ok | infeasible | timeout → UI

해 없음:   infeasible + conflicts → POST /api/py/explain → Claude 설명 + 제안 후보 ≤3
           → 후보마다 재풀이 검증 → 해가 나오는 제안만 → 사용자 수락 → /solve 재호출
```

## API 계약
```
POST /api/py/translate
  req: { text, scope: "ward"|"month", context: { nurses, period, today }, input_version }
  res: { status: "ok", constraints } | { status: "clarify", question } | { status: "unsupported", reason }

POST /api/py/solve          # LLM을 쓰지 않음
  req: { nurses, period, holidays, staffing, constraints, carry_over?, previous?, input_version }
  res: { status: "ok", result: { assignments, summary, stats, soft_violations, diff?, optimal } }
     | { status: "infeasible", conflicts } | { status: "timeout" }

POST /api/py/explain
  req: { request, conflicts }
  res: { text, proposals }  # 재풀이로 검증된 것만
```
- **도메인 결과**는 200과 `status`로 준다.
- **시스템 오류**는 non-2xx와 `{ error: { code, message, request_id } }`로 준다.
- 모든 응답은 요청의 `input_version`을 그대로 돌려준다.

| HTTP | code | 조건 |
|---|---|---|
| 413 | `PAYLOAD_TOO_LARGE` | 간호사 40명, 제약 200개, 텍스트 1000자 초과 |
| 422 | `VALIDATION_ERROR` | Pydantic 또는 참조 무결성 실패(필드 경로 포함) |
| 502 | `LLM_INVALID_OUTPUT` | 재시도 후에도 스키마 위반 |
| 503 | `LLM_UNAVAILABLE` | Anthropic 장애 또는 한도 초과 |
| 500 | `CONFIG_ERROR` / `INTERNAL` | 키 누락이나 401, 예상하지 못한 예외(스택은 로그에만 남김) |

## 시간 예산
| 작업 | 상한 |
|---|---|
| solve | 10초 |
| 충돌 분석 | +5초 |
| 제안 검증 | 3초 × 3 |
| translate | LLM 1회 + 재시도 2회. `max_tokens` 제한, SDK 타임아웃 30초 |

- Vercel 함수의 `maxDuration`은 60초다.
- 솔버에는 항상 `max_time_in_seconds`를 건다.
- 해는 찾았지만 시간이 초과되면 `optimal: false`로 반환한다.

## 상태 관리
- **클라이언트**: Zustand + persist(localStorage)가 유일한 저장소다.
  - 저장 대상은 병동, 제약 카드, 결과, 확정본(`previous`)이다.
  - persist `version`이 다르거나 데이터가 손상됐으면 초기화한다.
  - localStorage를 쓸 수 없으면 메모리로 동작한다.
- **서버**: 무상태다. 매 요청에 필요한 상태를 통째로 받는다. DB와 세션은 없다.
- **stale 처리**: 상태가 바뀔 때마다 `input_version`을 증가시키고, 응답의 버전이 현재와 다르면 stale로 표시한다.

## 환경
- 로컬
  - `npm run dev`: Next(:3000)를 띄우고, `/api/py/*`를 uvicorn(:8000)으로 리라이트한다.
  - Python은 `.venv`(3.12, uv)를 쓴다.
- 배포
  - Vercel 프로젝트 1개다. `/api/py/*`는 `api/index.py`로 리라이트된다.
  - `.vercelignore`로 docs, phases, scripts, eval, tests를 제외한다.
- env
  - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`(기본값 `claude-sonnet-5-5`)
