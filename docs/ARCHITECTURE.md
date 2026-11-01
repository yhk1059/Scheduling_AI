# 아키텍처

## 디렉토리 구조
```
app/                  # Next.js 페이지 (UI 세부는 UI_GUIDE 확정 후)
├── page.tsx          # 랜딩 (/) — 정적, API 호출 없음
├── a/[token]/page.tsx # 직원 가능 시간 입력 (/a/{공용 토큰}) — 로그인 없음, 토큰 DB 함수만 호출
└── app/page.tsx      # 앱 (/app) — 시작, 매장 홈, 매장 설정, 기간 작업 (PRD 화면)
components/           # UI 컴포넌트
lib/
├── store.ts          # Zustand. 로그인한 매니저의 매장 문서와 동기화하고 localStorage는 캐시로만 쓴다
├── availability.ts   # 가능 시간 → 근무조 판정 → 반드시 규칙 (순수 함수)
├── supabase.ts       # Google 로그인, 매장 문서 load/save/delete, 직원 링크 — 얇은 래퍼
├── api.ts            # /api/py/* fetch 래퍼
├── roster-import.ts  # 지난 근무(이월) 붙여넣기 파싱 (순수 함수)
├── csv.ts            # CSV 직렬화 (순수 함수)
├── types.gen.ts      # Pydantic JSON Schema에서 생성 (직접 수정 금지)
└── samples/         # shop-12.json(샘플 매장), demo-schedule.json(랜딩 히어로 근무표, npm run gen:demo)
public/demo.mp4       # 데모 영상 (npm run record:demo, ADR-022)
api/index.py          # Vercel Python 함수 진입점 (import만 함)
backend/              # FastAPI 앱 (무상태)
├── routes.py         # HTTP 계층, solver와 llm 오케스트레이션
├── env.py            # .env.local 로더 (로컬 전용)
├── domain/           # models.py (Pydantic, 단일 기준), constants.py (상한, 시간, 가중치)
├── solver/           # CP-SAT: model, select(대상 고르기), compile(식 → CP-SAT, hard·soft), evaluate(근무표 위 식 평가), stats, conflicts — llm을 import하지 않음
├── llm/              # client, translator, explainer, prompts, pseudonym — solver를 import하지 않음
├── gen_types.py      # JSON Schema → lib/types.gen.ts
├── gen_demo.py       # 샘플 매장 → lib/samples/demo-schedule.json (랜딩 히어로)
└── tests/
eval/                 # dataset.jsonl, run.py, results.md
e2e/                  # Playwright 데모 저니 (수동 실행, 실제 API, 테스트 전용 계정, ADR-013, ADR-020)
supabase/migrations/  # shops 테이블 + RLS, availability_links·availability_shares 테이블 + 토큰 DB 함수 (ADR-014, ADR-020, ADR-021)
scripts/              # harness 전용 + seed.ts(수동 테스트 시드), record-demo.ts(데모 영상 녹화) — 앱 코드를 두지 않음
```

## 패턴
- **역할 분리**: LLM은 매니저의 말을 규칙 식(제한된 식 언어, ADR-019)과 근무 형태 변경으로 세우는 모델러이고, 충돌을 설명하는 해설자다. 실행 코드는 생성하지 않는다. 계산은 CP-SAT만 한다.
- **식 언어**: 규칙 = 범위(`for_each`) + 본문(`require`: 세기·비교·그리고/또는·`when`·`offset`, 또는 내장 함수 `balance`). 재귀하지 않는다. 같은 식을 `solver/compile.py`가 CP-SAT로 바꾸고 `solver/evaluate.py`가 근무표 위에서 평가한다(위반 통계, eval 판정, 예시 판정). 식 안의 숫자는 이름 있는 `values`(조정 가능한 값)다.
- **단일 스키마**: `backend/domain/models.py`가 다음의 단일 기준이다.
  - Claude tool `input_schema`
  - 입력 검증
  - 솔버 입력
  - TS 타입
- **LLM 호출 방식**: Anthropic SDK의 tool use로 구조화 출력을 받는다. `tool_choice`로 tool 호출을 강제하고, 스트리밍은 쓰지 않는다. 프롬프트는 `backend/llm/prompts.py`의 상수다.
- **LLM 출력 검증**: Pydantic 검증, 참조 무결성(id·태그·코드·날짜·값 이름), 빈 대상, 싼 모순 검사를 거친 뒤에만 쓴다. 실패하면 오류를 넣어 최대 2회 재시도한다. 결과는 항상 "제안"이고, 사람이 [적용]하거나 서버가 재풀이로 검증해야 반영된다.
- **결정적 카드 문장**: 카드 문장은 `lib/wording.ts`가 식에서 만든다. LLM이 쓴 문장을 카드 해석으로 쓰지 않는다.
- **결정적 대체 경로**: explain이 실패해도 충돌 제약의 `source_text`와 [이번 기간만 끄기]로 진행할 수 있다.
- **가명 처리**: LLM 호출 전에 직원 이름을 `E01` 같은 가명으로 바꾸고, 응답에서 되돌린다.
- **가능 시간**: 직원이 입력한 시간대를 `lib/availability.ts`가 근무조 시각과 비교해, 시각을 완전히 덮지 못하는 칸을 금지하는 반드시 규칙으로 바꾼다. 규칙 id는 `avail-`로 시작하고, 요청에 담을 때만 만들며 매장 조건에 저장하지 않는다. LLM을 거치지 않는다. explain은 이 규칙의 완화를 거부한다. 고정 근무처럼 규칙·요청 200개 상한과 따로 세되, 이 모양(사람마다 고른 칸의 수 = 0인 반드시 규칙)일 때만 그렇다. 칸 고정은 가능 시간보다 우선하므로 고정한 칸은 규칙에서 뺀다.
- **직원 링크**: `availability_shares`에 근무표마다 공용 토큰 한 행을, `availability_links`에 직원·근무표마다 한 행을 둔다. anon에게 테이블 권한을 주지 않고 `security definer` DB 함수 `get_availability_roster(공용 토큰)`, `get_availability(직원 토큰)`, `submit_availability(직원 토큰, slots)`만 연다. 명단 함수는 이름, 직원 토큰, 제출 여부를 돌려주고 칸은 돌려주지 않는다. 제출 함수는 잠긴 행을 거부한다. 매니저는 RLS로 자기 매장 행만 읽고 쓴다.
- **수동 조정**: 칸 수정은 "고정 배정" 제약이 된다. 솔버 경로는 하나다.
- **매장 구조**: 근무 코드(이름, 시작·끝 시각, 실근무 시간, 세는 근무조)는 `ShopConfig`이고 매 요청에 담는다. 칸마다 코드 하나이며, 더블은 복합 코드다. 시작·끝 시각은 솔버가 직접 쓰지 않고 가능 시간 판정, LLM 문맥, 화면에 쓴다. 자정을 넘기는 근무조는 받지 않는다. 시간대 필요 인원은 LLM이 그 시간을 덮는 코드 집합을 세는 규칙으로 세운다(ADR-020). 코드 참조(제약, 이월, 이전 해, 이력)는 모두 `config`로 검증한다.
- **제약 단일 표현**: 필요 인원(폼이든 말이든)도 날마다 범위의 규칙 식이고 `default: true`(기본 규칙)다. 별도의 staffing 필드는 없다. 모든 제약은 `enabled` 플래그를 가진다. [이번 기간만 끄기]는 그 기간의 꺼진 제약 id 목록에 넣고, 매장 조건 원본은 바꾸지 않는다. 요청을 보낼 때 이 목록으로 `enabled=false`를 채운다.
- **기간 연속성**(ADR-015): 다음 기간의 `carry_over`는 지난 확정본에서, 최근 28일 확정 배정 원본(`history`)은 클라이언트가 모아 요청에 담고, 고르게 블록마다 세는 일은 백엔드가 한다. 운영 중인 기간의 지난 날짜는 고정 배정 제약으로 잠근다. 모두 `lib/`의 순수 함수다.
- **직원 id**: 명단에 처음 들어올 때 한 번 부여하고 다시 매기지 않는다. 퇴사·휴직은 `active=false`로 둔다.
- **로컬 env**: `backend/env.py`가 `.env.local`을 읽는다(이미 설정된 env는 덮어쓰지 않음). 로컬 uvicorn과 eval에서 쓰고, Vercel에서는 프로젝트 env를 쓴다.

## 데이터 흐름
```
규칙 입력:  UI → POST /api/py/translate → 가명 치환 → Claude(tool use) → Pydantic·참조·빈 대상·모순 검증(재시도 ≤2)
           → 규칙마다 예시 판정(routes가 solver.evaluate로 샘플 근무표의 위반 ≤3)
           → 규칙 카드(결정적 문장 + 예시) + 설정 변경 카드 → 사용자 [적용] → store

생성:      store 전체 → POST /api/py/solve → CP-SAT → ok | infeasible | timeout → UI

해 없음:   infeasible + conflicts → POST /api/py/explain → Claude 설명 + 제안 후보 ≤3
           → 후보마다 재풀이 검증 → 해가 나오는 제안만 → 사용자 수락 → /solve 재호출

다음 기간: 지난 확정본 → carry_over, 최근 28일 배정 → history (lib/ 순수 함수) → 요청 → /solve

가능 시간: 매니저 store → availability_links·availability_shares 행 생성(토큰) → 공용 링크 복사
           직원 /a/{공용 토큰} → 이름 선택(get_availability_roster) → supabase-js rpc(get·submit_availability) → availability_links
           매니저 → RLS로 행 읽기 → lib/availability.ts → avail- 규칙을 요청에 담아 /solve

저장:      store ↔ supabase-js ↔ shops(data jsonb, RLS owner_id = auth.uid())
           (backend/는 DB에 접근하지 않는다. 계산 요청은 지금처럼 store 상태를 통째로 보낸다)
```

## API 계약
```
POST /api/py/translate
  req: { text, scope: "shop"|"period", context: { config, employees, period, today }, input_version }
  res: { status: "ok", constraints, config_changes, examples } | { status: "clarify", question } | { status: "unsupported", reason }
       # examples: { 규칙 id: [{ employee_ids, days, cells, detail }] } 규칙마다 ≤ 3

POST /api/py/solve          # LLM을 쓰지 않음
  req: { config, employees, period, holidays, constraints, carry_over?, previous?, history?, input_version }
  res: { status: "ok", result: { assignments, summary, stats, soft_violations, diff?, optimal } }
     | { status: "infeasible", conflicts } | { status: "timeout" }

POST /api/py/explain
  req: { request, conflicts }
  res: { text, proposals }  # 재풀이로 검증된 것만. 변경은 disable | set_value | set_hardness
```
- `period`는 `{ start_date, length }`다(ADR-015). 날짜는 기간 안의 1..length 인덱스로 주고받는다.
- `history`는 `{ start_date, rows: { employee_id: [code…] }, holidays: [date…] }`, 최근 28일 확정 배정 원본이다.
- `constraints`는 `rule | fixed_assignment`(type 판별)다. 형식은 `backend/domain/models.py`가 기준이다.
- **도메인 결과**는 200과 `status`로 준다.
- **시스템 오류**는 non-2xx와 `{ error: { code, message, request_id } }`로 준다.
- 모든 응답은 요청의 `input_version`을 그대로 돌려준다.

| HTTP | code | 조건 |
|---|---|---|
| 413 | `PAYLOAD_TOO_LARGE` | 직원 40명, 제약 200개(고정 근무·가능 시간 규칙 제외), 가능 시간 규칙 280개, 고정 근무 40×31개, 텍스트 1000자, 근무 코드 8개, 사람당 태그 5개 초과 |
| 422 | `VALIDATION_ERROR` | Pydantic 또는 참조 무결성 실패(필드 경로 포함). 식 상한(값 5개, 비교 6개, offset −7..+14·폭 14, 창 2~14일) 초과 포함 |
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
- 입력 상한을 꽉 채운 최악 매장(40명 × 31일 × 코드 8개, 규칙 60개)이 이 예산 안에 해를 내는지 `npm run bench`로 확인한다(`npm run test`에는 넣지 않는다). 넘으면 예산을 늘리지 않고 상한을 낮춘다.
- 해는 찾았지만 시간이 초과되면 `optimal: false`로 반환한다.

## 상태 관리
- **클라이언트 상태 구조**: `shop + periods[]`
  - `shop`: 근무 형태(`config`), 명단(`id`, `active`, `tags`), 매장 조건(필요 인원 등 기본 규칙 포함), 기간 단위
  - `periods[]`: 날짜 범위, 공휴일, 요청, 꺼진 제약 id, 결과, 상태(초안/확정), 확정본 버전 목록
  - 이력은 확정된 `periods[]`다. 별도 저장소를 두지 않는다.
- **저장**
  - 상태를 `shops.data` 문서 하나로 저장한다. 게스트 모드는 없다. localStorage는 저장 실패 때의 캐시다. 마지막 저장이 이기고 `updated_at`을 보여 준다. 로그아웃하면 localStorage를 비운다.
  - persist `version`이 다르거나 데이터가 손상됐으면 초기화한다. 옛 형식 변환은 두지 않는다(ADR-020).
- **서버(FastAPI)**: 무상태다. 매 요청에 필요한 상태를 통째로 받는다. DB와 세션은 없다.
- **stale 처리**: 상태가 바뀔 때마다 `input_version`을 증가시키고, 응답의 버전이 현재와 다르면 stale로 표시한다.

## 기술 스택과 쓰지 않는 것
| 영역 | 사용 | 쓰지 않는 것 |
|---|---|---|
| 프론트 | Next.js 16 App Router, TS strict, Tailwind 4, Zustand + persist, `@supabase/supabase-js` | Redux, React Query, UI 컴포넌트 라이브러리, 차트 라이브러리, `@supabase/ssr`, 미들웨어 인증 |
| 저장·인증 | Supabase(Postgres + Auth, Google OAuth), `shops`·`availability_links`·`availability_shares` 테이블 + RLS, 토큰 DB 함수 (ADR-014, ADR-020, ADR-021) | 정규화 테이블, ORM, Edge Function, service role 키, 직원 계정 |
| 백엔드 | Python 3.12, FastAPI, Pydantic v2, ortools, anthropic (`requirements.txt` 고정) | LangChain, 에이전트 프레임워크, ORM, DB 접근. **런타임 Python 의존성 추가 금지**(번들 한도, ADR-007) |
| LLM | Claude tool use | 스트리밍, RAG, 벡터 DB, 멀티 에이전트 |
| 테스트 | pytest(솔버는 실제로 돌리고 LLM은 mock), vitest(`lib/` 순수 함수), Playwright(`e2e/`, 수동 실행, ADR-013) | 컴포넌트 테스트 프레임워크 |
| 관측 | stdout 구조화 로그(JSON 한 줄: `request_id`, 엔드포인트, 소요 시간, LLM 재시도 횟수, 토큰 수). 키와 이름 원문은 남기지 않는다 | 모니터링 도구 |
| 배포 | Vercel | Docker, 별도 CI |

## 환경
- 로컬
  - `npm run dev`: Next(:3000)를 띄우고, `/api/py/*`를 uvicorn(:8000)으로 리라이트한다.
  - Python은 `.venv`(3.12, uv)를 쓴다.
- 배포
  - Vercel 프로젝트 1개다. `/api/py/*`는 `api/index.py`로 리라이트된다.
  - `.vercelignore`로 docs, phases, scripts, eval, tests, e2e를 제외한다.
- env
  - 서버: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`(기본값 `claude-sonnet-5-5`)
  - 클라이언트: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. anon 키는 공개되어도 되고, 접근은 RLS로 막는다.
- Google OAuth: Supabase 대시보드의 Auth Providers에서 켠다. 리디렉트 URL에 로컬(`http://localhost:3000/app`)과 배포 도메인을 등록한다.
