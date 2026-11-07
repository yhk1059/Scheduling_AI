# Step 7: client-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/structure-blocks-design-2026-10-29.md`** (§2 데이터 형식, §5.3 설정 변경 카드, §6 카드 표현, §8 화면 중 날짜 규칙, §9 저장 이전)
- `/docs/ARCHITECTURE.md` (상태 관리, API 계약), `/docs/UI_GUIDE.md` ("규칙·요청 카드", "문구")
- `/lib/store.ts`, `/lib/continuity.ts`, `/lib/period.ts`, `/lib/wording.ts`, `/lib/csv.ts`, `/lib/roster-import.ts`, `/lib/api.ts`, `/lib/supabase.ts` 와 각 `*.test.ts`
- `/backend/gen_types.py`, `/backend/domain/models.py` (step 6 결과)
- `/backend/tests/golden/convert-cases.json` (step 2: Python 변환 결과)
- `/e2e/fixtures/ward-oct.json` (v4 저장 문서 예)

## 배경

백엔드가 새 형식이 됐다. 이 step은 클라이언트의 **데이터 층**(`lib/`)을 새 형식으로 바꾼다. 화면 기능(근무 형태 탭, 태그 칩, 새 카드, 시작일 선택)은 step 8·9에서 하고, 이 step에서는 컴포넌트가 **컴파일되고 지금 화면이 기본 config로 동작할 만큼만** 고친다.

## 작업

**`lib/`의 순수 함수는 테스트를 먼저 쓴다(TDD, vitest).**

### 1. 타입
- `npm run gen:types`로 `lib/types.gen.ts`를 다시 만든다.

### 2. 저장 이전 (`lib/migrate.ts`, 설계 §9)
- `migrateV4(doc) -> v5 doc | null`(순수 함수). 템플릿 → 블록 변환은 설계 §2.5와 같고, **`backend/tests/golden/convert-cases.json`의 모든 케이스에서 Python 변환과 같은 결과**를 내야 한다(vitest가 이 파일을 읽어 비교).
- 변환 대상: `ward.rules`, `ward.pendingRules`, 모든 기간의 `requests`, `pendingRequests`, `ruleOverrides`, 확정본 버전의 `requests`, `snapshot.rules`. 명단(`ward.nurses`, `snapshot.nurses`)의 `night_only` → 태그. `ward.config` = 기본 구조. 기본 규칙 "나이트 전담은 나이트와 휴무만"을 병동 규칙에 넣는다(id는 고정 값).
- 변환하지 못한 제약(예상 밖 params)은 `ward.unconverted: { source_text: string }[]`로 옮긴다(화면은 step 8). 문서 전체를 버리지 않는다.
- 옛 결과(`result`, 버전의 `result`)는 형식을 바꾸지 않고 그대로 둔다. 작성 중·운영 중 기간은 stale로 표시되게 `resultVersion`을 맞춘다.
- `STORAGE_VERSION = 5`. persist `migrate`는 `fromVersion === 4`면 `migrateV4`, 그 밖은 지금처럼 초기화. Supabase 불러오기(`store.ts`의 버전 비교)도 같은 함수를 거친다. 테스트: `e2e/fixtures/ward-oct.json`을 v4로 넣으면 v5로 열리고 규칙·요청 수가 같고 `resetNotice`가 뜨지 않는다. 서버 문서 v4도 같다.
- `e2e/fixtures/`의 v4 픽스처는 그대로 둔다(옛 저장본 열기 시나리오에 쓴다).

### 3. store (`lib/store.ts`)
- `Ward.config`, 간호사 `tags`, 블록 제약, `unconverted`. 기간 요청 본문에 `config`, `history`(원본)를 담는다.
- 액션: `setShift`/`addShift`/`setShiftActive`(쓰인 코드는 끄기만), 태그 추가·삭제, 규칙 `priority` 변경, 설정 변경 카드(대기 목록에 `config_changes`를 카드로 두고, 딸린 규칙 카드의 [적용]이 설정 카드도 적용하고, 설정 카드 삭제가 딸린 카드도 지우는 동작, 설계 §5.3).
- 필요 인원(`setCoverage`)은 세기 블록(per day, `days.kind` weekday/weekend, `shifts.in=[code]`, min=max)을 만든다. 행은 활성 기본 코드(복합 제외).
- 기간 만들기: 첫 근무표는 시작일 인자를 받는다(달력 월은 1~28일만, 아니면 거부). 다음 근무표는 직전 다음 날, `postponeStart(periodId, date)`는 뒤로만(직전 끝 다음 날보다 앞이면 거부).

### 4. 기간·이월·이력 (`lib/period.ts`, `lib/continuity.ts`)
- `period.ts`: 시작일을 받는 기간 계산. 주 단위는 아무 날 + 7/14/28일, 달력 월은 시작일 ~ 다음 달 같은 날 전날(1일이면 지금과 같음). 기본 제안값은 지금의 `firstPeriodStart`.
- 이월은 직전 기간과 이어질 때만 자동(미루면 끊김).
- `historyFor(periods, target, nurseIds)` → 최근 28일 확정 배정 원본 + 그 날짜의 공휴일. 기존 `historyLoadFor`는 화면의 "최근 4주 나이트·주말" 숫자를 위해 원본에서 계산하는 함수로 바꾼다.

### 5. 문구·통계·CSV (`lib/wording.ts`, 새 `lib/stats.ts`, `lib/csv.ts`, `lib/roster-import.ts`)
- `describeBlock(block, config, nurses, period)`와 `presetName(block)`(설계 §6 표·틀). 테스트: 변환표의 모든 모양(convert-cases.json) + 새 예시 10개 이상의 문장을 고정한다. 근무 이름은 config의 `name`.
- `statsFromAssignments(assignments, config, period, holidays)`: 코드별 수, 근무 시간, 주말·공휴일 근무, 최대 연속 근무, 편차. 변환 전 확정본 표시용(설계 ★12).
- CSV: 합계 열은 활성 코드, 하단 합계는 근무조별(복합 코드는 parts마다 더함).
- 이월 붙여넣기 파싱은 config 코드를 받는다.

### 6. 컴포넌트 컴파일
- 바뀐 타입에 맞춰 컴포넌트를 **최소로** 고친다: `night_only` 체크박스는 `나이트전담` 태그 토글로 임시 연결, 통계·그리드는 `counts`로, 카드 문장은 `describeBlock`, 템플릿 이름은 `presetName`. 새 화면 요소는 만들지 않는다.

## Acceptance Criteria

```bash
cp lib/types.gen.ts "${TMPDIR:-/tmp}/types.gen.before.ts" && npm run gen:types && cmp lib/types.gen.ts "${TMPDIR:-/tmp}/types.gen.before.ts"
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(첫 줄: 작업 트리의 `types.gen.ts`가 지금 모델에서 다시 생성한 것과 같은지).
2. 짧은 동작 확인: `npm run dev`로 띄워 빈 병동 → 명단 3명 → 필요 인원 → 규칙 하나 입력·적용 → 근무표 만들기가 되는지 Playwright 스크립트나 브라우저로 확인하고 서버를 끈다. 다른 프로세스가 3000/8000 포트를 쓰고 있으면 이 확인은 건너뛰고 summary에 적는다(남의 프로세스를 끄지 않는다).
3. 아키텍처 체크: DB 접근은 클라이언트 supabase-js만인가? `lib/`의 새 순수 함수에 테스트가 있는가?
4. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 멈추지 말고 "기본값은 지금 동작과 같게, 가장 단순하게" 원칙으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 새 화면 기능(근무 형태 탭, 태그 칩 입력, 중요도 select, 설정 변경 카드 UI, 시작일 입력)을 만들지 마라. 이유: step 8·9의 범위다.
- `lib/types.gen.ts`를 손으로 고치지 마라.
- 백엔드를 바꾸지 마라. 클라이언트와 계약이 다르면 계약(ARCHITECTURE)과 설계 문서를 따른다.
- 기존 테스트를 깨뜨리지 마라(옛 형식을 기대하던 테스트는 새 형식으로 바꾼다).
