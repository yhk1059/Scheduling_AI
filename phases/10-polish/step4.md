# Step 4: josa-lib

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — `lib/` 순수 함수는 TDD
- `/docs/UI_GUIDE.md` — "문구"(해요체, 같은 것은 같은 말로), "규칙·요청 카드"(해석 문장)
- `/lib/wording.ts` — `josa(word, a, b)`(지금은 한글 마지막 글자의 받침만 본다), `describeRule`과 그 조각 함수들(`shiftsLabel`, `peopleLabel`, `daysLabel`, `describeShiftChange`), 조사가 들어가는 템플릿 문자열
- `/lib/wording.test.ts` — 테스트 방식
- `/components/ConstraintCard.tsx` — `josa(conflictName, "과", "와")`
- `/components/ConfirmedPeriod.tsx` — `{WEEKDAYS[todayInfo.weekday]}예요`(요일 뒤 조사가 고정돼 있다)
- `/components/ScheduleStep.tsx` — `aria-label={`${code}로 고정`}`(근무 코드 뒤 조사가 고정돼 있다)
- `/components/*.tsx` — `grep -n '}은 \|}는 \|}이 \|}가 \|}을 \|}를 \|}과 \|}와 \|}으로 \|}로 \|}예요\|}이에요' components/*.tsx lib/*.ts`로 변수 뒤에 조사가 고정된 곳을 전부 찾는다

## 배경

해석 문장과 화면 문장에서 조사(과/와, 을/를, 이/가, 은/는, 으로/로, 이에요/예요)가 앞말의 받침과 맞지 않는 곳이 있다. `josa`는 한글 받침만 보고, 숫자("11/17"의 7은 "칠"로 받침 있음), 영문 근무 코드("M"은 "엠"으로 받침 있음), 따옴표·괄호로 끝나는 말(`“마감”`, `더블(D)`)을 처리하지 못한다. 또 "으로/로"는 ㄹ 받침 뒤에서 "로"다("일로", "오픈 1명으로"). 변수 뒤에 조사를 고정해 둔 템플릿도 몇 곳 있다. 이 step은 `josa`를 넓히고, 변수 뒤 조사를 모두 `josa`로 바꾼다. LLM이 쓰는 설명 문장의 조사는 step 5(백엔드)가 다룬다.

## 작업

TDD: `lib/wording.test.ts`에 `josa` 테스트를 먼저 더한다.

1. `lib/wording.ts` `josa(word, a, b)`를 넓힌다(시그니처는 그대로):
   - 끝의 닫는 기호와 공백을 건너뛴다: `” " ’ ' ) 」 』 ]`. 예: `josa("“마감”", "과", "와")` → "과".
   - 마지막 글자가 한글이면 받침으로(지금과 같다). 단 `a`가 "으로"이고 받침이 ㄹ이면 `b`("로")를 돌려준다.
   - 숫자면 읽는 소리로: 0 영(받침), 1 일(ㄹ → 으로는 "로"), 2 이, 3 삼(받침), 4 사, 5 오, 6 육(받침), 7 칠(ㄹ), 8 팔(ㄹ), 9 구.
   - 영문자면 읽는 소리로: L·M·N·R(엘·엠·엔·알)은 받침 있음(L·R은 ㄹ), 그 밖은 없음. 대소문자 같게.
   - 그 밖의 글자(기호만 있는 말, 빈 문자열)는 `b`.
   - 테스트: "마감"→과, "오픈"→과, "휴무"→와, "“오픈”"→과, "더블(D)"→와("D"=디), "M"→과, "A"→와, "11/17"→과·"11/17"→"로"(ㄹ), "3"→으로, "2"→로, "일"→로, "" → b, "월"→"이에요", "화"→"예요".
2. 변수 뒤 조사를 `josa`로 바꾼다(찾은 곳 전부. 최소 아래 둘):
   - `components/ConfirmedPeriod.tsx`: `{요일}예요` → `{요일}{josa(요일, "이에요", "예요")}`(월·일·목·금은 "이에요").
   - `components/ScheduleStep.tsx`: `${code}로 고정` → `${code}${josa(code, "으로", "로")} 고정`("M으로", "A로", "C로"). e2e가 이 `aria-label`을 쓰면 마지막 step이 맞춘다 — summary에 적는다.
   - `lib/wording.ts` 안의 템플릿(`describeRule`, `describeShiftChange`, 요약 문장 등)에서 변수 바로 뒤에 조사가 고정된 곳. 각 변경에 `wording.test.ts` 케이스를 하나씩 더한다(바뀐 문장 전체를 비교).
3. 조사가 없는 자리(명사 나열 "·", 숫자 뒤 "명", "일")는 건드리지 않는다.

## Acceptance Criteria

```bash
npx vitest run lib/wording.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `josa`의 시그니처가 그대로이고 기존 호출이 모두 그대로 동작하는가(기존 wording 테스트 통과)?
   - 변수 뒤 고정 조사가 `components/`·`lib/`에 남아 있지 않은가(위 grep 다시 실행)?
   - 화면 구조·접근 가능한 이름은 조사 말고 바뀐 것이 없는가?
3. 결과에 따라 `phases/10-polish/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 접근 가능한 이름(`"{code}로 고정"` → 조사 변화)과 고친 문장 목록을 적어라**(e2e가 셀렉터로 쓸 수 있다). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 한글 형태소 분석 패키지를 더하지 마라. 이유: 마지막 글자 규칙으로 충분하고 의존을 늘리지 않는다.
- 문장의 뜻·용어를 바꾸지 마라(조사만). 이유: UI_GUIDE "문구" 표와 e2e가 문장을 본다. 용어 정리는 step 8의 범위다.
- `backend/`를 고치지 마라. 이유: LLM 설명의 조사는 step 5가 복원 단계에서 고친다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
