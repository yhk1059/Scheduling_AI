# Step 3: rule-card-edit

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/UI_GUIDE.md` — "규칙·요청 카드 — 답장처럼"(조정 가능한 값과 [수정]), "입력 필드", "문구" 표
- `/docs/ADR.md` — ADR-019("조정 가능한 값": 카드 [수정]은 값만 바꾸고 식 구조는 고치지 않는다 — 이 step은 비교 연산자 하나만 예외로 연다)
- `/lib/rules.ts` — `ruleShape`(kind "count"의 `min`·`max`와 `Bound.name`), `normalizeRule`
- `/lib/store.ts` — `withRuleValue`, `setRuleValue`·`setRequestValue`(값을 바꾸는 경로), `editShop`·`editPeriod`(inputVersion 증가), `CardPatch`
- `/lib/store.test.ts` — "매장 규칙 카드" describe의 값 수정 테스트
- `/lib/wording.ts` — `boundLabel`, `cmpPhrase`(이상/이하/정확히 문장을 어떻게 만드는지. 바꾸지 않는다)
- `/components/ConstraintCard.tsx` — `fieldsOf`, `toDraft`, `fromDraft`, `FieldInput`, `save`, "바꾸려면 말로 다시 적어 주세요" 안내
- `/lib/coverage-conflict.ts` — step 0(이 step과 직접 관계는 없지만 "필요 인원 모양" 판정을 같은 방식으로 한다)

## 배경

카드 [수정]은 지금 숫자만 바꿀 수 있고, "정확히 2명"을 "2명 이상"으로 바꾸려면 말로 다시 적어야 한다. step 2에서 기본 해석이 "이상"으로 바뀌었으므로, 이미 저장된 "정확히" 카드를 매니저가 손으로 고칠 길이 필요하다. 이 step은 **비교 하나(`eq` 또는 `ge`)에 조정 가능한 값이 걸린 세기 규칙**에 한해 [수정] 폼에서 이상/정확히를 고를 수 있게 한다. 범위(`3~4명`, `all[ge, le]`)와 조건부·순서 규칙은 그대로 말로 다시 적는다.

## 작업

TDD: `lib/store.test.ts`에 테스트를 먼저 쓰고, 통과하는 구현을 `lib/store.ts`에 만든 뒤 컴포넌트를 고친다.

1. `lib/store.ts`(`withRuleValue` 옆):
   ```ts
   export type Comparison = "ge" | "eq";
   /** [수정] 폼에서 고를 수 있는 비교. then이 비교 하나이고 오른쪽이 조정 가능한 값이며 op가 ge·eq인 세기 규칙만. 아니면 null. */
   export function comparisonOf(c: ConstraintSpec): Comparison | null;
   /** 비교를 바꾼 규칙(normalizeRule 적용). 바꿀 수 없는 규칙이면 null. 값 label은 "최소 인원" ↔ "인원"처럼 "최소 " 접두사를 넣고 뺀다. */
   export function withRuleComparison(c: ConstraintSpec, op: Comparison): ConstraintSpec | null;
   ```
   - 판정은 `normalizeRule(c).body`가 `kind: "require"`, `when` 없음, `then`이 `Cmp` 하나(`all`·`any` 아님), `then.right`가 `{ value: 이름 }`, `then.op`가 `"ge"` 또는 `"eq"`, `then.left.offset` 없음일 때다. `ruleShape`로 `kind: "count"`인지까지 확인한다(그 밖의 식 모양은 열지 않는다).
   - label 규칙: `eq`로 바꾸면 label이 `"최소 "`로 시작할 때 그 접두사를 뗀다(`"최소 인원"` → `"인원"`, `"최소 횟수"` → `"횟수"`). `ge`로 바꾸면 label이 `"최소 "`로 시작하지 않을 때 앞에 붙인다. 그 밖의 label은 그대로 둔다.
   - `le`는 열지 않는다(이하로 바꾸는 요구가 없고, "이하"로 바뀐 필요 인원은 뜻이 완전히 달라진다).
   - store 액션: `setRuleComparison(id, op)`(매장 규칙 원본, `editShop`), `setRequestComparison(periodId, id, op)`(요청, `editPeriod`). 대기 카드에도 적용된다(`setRuleValue`가 대기·적용을 어떻게 나누는지 그대로 따른다). 바꿀 수 없는 규칙이면 아무것도 하지 않는다. `AppState` 인터페이스에 시그니처를 더한다.
   - 테스트: `comparisonOf`가 eq/ge 단일 비교에만 값을 주고 범위·조건부·고르게·칸 고정에는 null, `withRuleComparison`이 op와 label을 바꾸고 다른 필드(id, values의 value, hardness, default)는 유지, `setRuleComparison`이 inputVersion을 올리고 원본을 바꾸는 것, 요청 쪽도 같은 것. `describeRule` 결과가 "평일마다 오픈 2명" → "평일마다 오픈 2명 이상"으로 바뀌는지 `lib/wording.test.ts`에 한 줄 더한다.
2. `components/ConstraintCard.tsx` [수정] 폼:
   - `comparisonOf(card)`가 null이 아니면 숫자 입력 오른쪽에 `<select>`를 둔다. `<label>`은 sr-only로 "비교", 옵션은 `이상`(ge) / `정확히`(eq). 높이는 기존 중요도 select와 같이 `h-8!`.
   - 저장할 때 op가 바뀌었으면 `setRuleComparison`/`setRequestComparison`을 값 저장 뒤에 부른다(둘 다 바뀌면 값 먼저, 비교 다음. 두 번 바뀌어 inputVersion이 두 번 올라가도 된다).
   - select가 있는 카드에서는 "바꾸려면 말로 다시 적어 주세요" 안내를 `값과 이상/정확히만 바꿀 수 있어요. 다른 건 말로 다시 적어 주세요`로 쓴다. select가 없는 카드는 기존 문장 그대로.
   - 필요 인원 폼(`CoverageForm`)이 같은 규칙을 다시 쓰면 폼의 최소·최대가 우선한다(기존 동작). 폼을 고치지 않는다.

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts lib/wording.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 식 구조 변경이 `then.op`와 값 label 하나로 제한되어 있는가(`for_each`·`left`·`when`은 그대로)?
   - 비교를 바꾼 규칙이 `normalizeRule`을 거쳐 Pydantic dump와 같은 모양인가(`/solve` 요청에 그대로 들어간다)?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`): 매장 설정 [매장 조건]의 필요 인원 카드 [수정]에서 `정확히` → `이상`으로 바꾸고 [저장]하면 해석 문장이 "… 2명 이상"으로 바뀌고 요약표 칸도 "2명 이상"이 된다. 범위 카드("1~2명")에는 select가 없다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(함수·액션 시그니처, 열린 규칙 모양, 안내 문구)"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**(select의 레이블 "비교", 옵션 글자, 안내 문장). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 범위·조건부·순서·고르게 규칙의 식 구조를 폼에서 바꾸게 하지 마라. 이유: ADR-019 "식 구조는 말로 다시 입력". 이 step은 단일 비교의 op 하나만 연다.
- `lib/wording.ts`의 문장 규칙을 바꾸지 마라. 이유: 문장은 식에서 결정적으로 만들어지므로 op를 바꾸면 저절로 맞는다.
- `lib/types.gen.ts`, `backend/`를 고치지 마라. 이유: 스키마 변경이 없다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
