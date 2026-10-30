# Step 9: client-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/notes/expression-rules-design-2026-10-30.md`** (§1 ★4~★7, §2.5 변환표, §4.2 예시, §5 카드 표현, §6 화면, §8 저장 이전)
- `/docs/ARCHITECTURE.md` (상태 관리, API 계약, 결정적 카드 문장), `/docs/UI_GUIDE.md` ("규칙·요청 카드", "필요 인원 폼", "처음 설정")
- `/lib/store.ts`, `/lib/migrate.ts`, `/lib/wording.ts`, `/lib/api.ts`, `/lib/stats.ts`, `/lib/continuity.ts`
- `/lib/store.test.ts`, `/lib/migrate.test.ts`, `/lib/wording.test.ts`
- `/backend/domain/models.py`, `/backend/domain/convert.py`, `/backend/gen_types.py` (step 8까지)
- `/backend/tests/golden/expr-convert-cases.json` (블록 → 식 공유 픽스처)

## 배경

백엔드는 step 8로 식 규칙만 받는다. 이 step은 **클라이언트 데이터 층**을 식으로 옮긴다: 생성 타입, 저장 문서 v5 → v6 변환, 결정적 카드 문장, store(기본 규칙, 조정 가능한 값, 필요 인원 범위, 카드 예시, 값 바꾸기 제안). 컴포넌트는 컴파일이 되도록 최소한만 고친다(화면 변경은 step 10·11).

## 작업

**`lib/`의 순수 함수는 테스트를 먼저 쓴다(TDD, vitest).** `lib/api.ts`·`lib/supabase.ts`는 TDD 대상이 아니다.

### 1. 타입
- `npm run gen:types`로 `lib/types.gen.ts`를 다시 만든다(직접 수정 금지).

### 2. 저장 이전 (`lib/migrate.ts`, 설계 §8)
- `blockToRules(block) -> Rule[]`: Python `block_to_rules`와 **같은 결과**(`expr-convert-cases.json`의 모든 쌍을 vitest에서 비교).
- `migrateV5(state, today) -> Data | null`: 병동 규칙·대기 카드·기간 요청·대기 요청·꺼진 id 목록(`ruleOverrides` 등)·확정본 버전 요청·snapshot을 식으로. 금지 패턴 분리로 생긴 id는 꺼진 id 목록에도 함께 넣는다. `cov-*`·`night-only`는 `default: true`. 변환 실패는 `ward.unconverted` 원문(ADR-018과 같은 방식). 옛 result는 그대로, 작성 중·운영 중 결과는 stale.
- `STORAGE_VERSION` 6. persist migrate: 4 → `migrateV4` → `migrateV5`, 5 → `migrateV5`. Supabase 불러오기도 같은 함수를 거친다.
- `normalizeRule`(Pydantic dump와 같은 기본값 채우기, weight = 중요도).

### 3. 카드 문장 (`lib/wording.ts`, 설계 §5)
- `presetName(rule)`: 모양 인식으로 지금 프리셋 이름(필요 인원·휴가·희망·기피·금지 순서·최대 연속 근무·최대 연속 나이트·나이트 다음 휴무·최소 휴무·근무 시간·휴무 간격·나이트 고르게·주말·공휴일 고르게·나이트 전담…). 안 맞으면 "조건 규칙"(when 있음) / "세는 규칙" / "순서 규칙"(offset 있음) / "고르게 규칙".
- `describeRule(rule, config, nurses, period) -> RuleSentence`: 프리셋 모양은 **지금 문장 그대로**(기존 `wording.test.ts` 스냅숏 유지), 그 밖은 "[범위]마다, [when]이면 [then]" 틀. 조정 가능한 값의 위치를 표시할 수 있게 `{ text: string, parts: Array<{ text } | { value: name, text }> }` 같은 구조로 돌려준다(화면이 밑줄을 그린다).
- 테스트: 변환표 모양 전부(기존 문장 동일)와 설계 §2.6 예시 6개를 스냅숏으로 고정. 내부 id·코드만 있는 표기가 나오지 않는다.
- 기존 `describeBlock` 호출부는 `describeRule`로 바꾸고 `describeBlock`을 지운다.

### 4. store (`lib/store.ts`)
- 필요 인원: `setCoverage(code, dayKind, min, max | null)`이 기본 규칙(`cov-{kind}-{code}`, `default: true`, day 범위, `then` = min/max에 따라 ge·le·eq 또는 All)을 만든다. `coverageRule`/`coverageRange(rules, code, kind) -> {min, max} | null`은 폼 모양에 맞는 규칙만 읽는다(토요일만 같은 규칙은 null).
- 처음 설정 단계: `hasCoverage`로 ②를 판정하지 않는다. `Ward.introSeen: boolean`(② [다음]을 한 번 누름)을 더하고 `setupStep`은 명단 없음 → 1, `!introSeen` → 2, 그 밖 → 3. `isWardReady`는 활성 간호사 ≥ 1. `markIntroSeen()` 액션.
- 기본 규칙: `removeRule`은 `default` 규칙이면 지우지 않고 `enabled=false`(끄기). 새 병동에는 나이트전담 기본 규칙만(필요 인원은 비어 있음).
- 조정 가능한 값: `setRuleValue(id, name, value)`(병동 규칙), `setRequestValue(periodId, id, name, value)`(기간 요청). 값 검증(≥ 0, 이름 존재).
- 카드 예시: `addPendingRules(cards, changes, examples?)`와 `addPendingRequests(periodId, cards, examples?)`가 카드별 예시를 저장한다(카드 상태 필드 `examples?: RuleExample[]`, 적용 후에도 유지, 요청 본문에는 넣지 않는다).
- 제안 적용: `applyChanges`가 `disable | set_value | set_hardness`를 처리한다(params 교체 경로 삭제).
- `toScheduleRequest`: 식 규칙과 칸 고정을 보낸다. 꺼진 근무 코드의 필요 인원 기본 규칙은 지금처럼 `enabled=false`로 보낸다.
- `lib/api.ts`: translate 응답의 `examples`를 넘긴다.

### 5. 컴포넌트 최소 수정
- 컴파일이 되도록 타입·함수 이름만 맞춘다(`describeBlock` → `describeRule().text`, `setCoverage` 시그니처, `ConstraintChange` 종류). 화면 구조는 바꾸지 않는다.
- e2e 헬퍼(`e2e/test-helpers.ts`)의 위반 평가가 블록을 가정하면 컴파일되게 식으로 바꾼다(실행은 step 12).

## Acceptance Criteria

```bash
npm run gen:types
npm run test
npm run build && npm run lint
npx tsc --noEmit
npx playwright test --list
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(`gen:types`로 다시 만든 `lib/types.gen.ts`는 이 step의 커밋에 포함한다).
2. 아키텍처 체크: `types.gen.ts`를 직접 수정하지 않았는가? 카드 문장에 LLM 문장을 쓰지 않는가? DB 접근은 supabase-js(RLS)로만 하는가? `lib/`의 새 순수 함수에 테스트가 있는가?
3. 동작 확인: `npm run dev`로 v5 픽스처(4-blocks 때 저장한 상태, 없으면 store 테스트 픽스처를 localStorage에 넣음)를 열어 v6으로 바뀌고 근무표 만들기가 ok인지 확인한다(임시 Playwright 가능, 커밋하지 않음). 3000/8000 포트를 다른 작업 트리가 쓰고 있으면 이 확인은 건너뛰고 summary에 적는다.
4. 결과에 따라 `phases/5-expressions/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(STORAGE_VERSION, 변환 동일성, store 액션, 문장 구조, 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 설계 문서에 없는 세부 결정은 summary에 `결정: …`으로 적는다.

## 금지사항

- `lib/types.gen.ts`를 손으로 고치지 마라. 이유: Pydantic이 단일 기준이다(ADR-003).
- 프리셋 모양의 기존 카드 문장을 바꾸지 마라. 이유: 사용자가 익숙한 문장이고, 변환이 같은 규칙이라는 확인 수단이다.
- 화면 레이아웃·새 UI를 만들지 마라. 이유: step 10·11이다.
- 예시(`examples`)를 `/solve` 요청 본문이나 Supabase 문서 크기를 키우는 곳에 중복 저장하지 마라. 카드 상태에 한 번만 둔다.
- 기존 테스트를 깨뜨리지 마라(형식이 바뀐 기대값은 같은 의미로 옮긴다).
