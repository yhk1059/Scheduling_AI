# Step 4: disabled-rules-summary

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/UI_GUIDE.md` — "요약 지표", "배지", "반복 사용 컴포넌트 › 꺼진 규칙·요청 카드", "매장 설정 › 탭 [매장 조건]"([삭제] 대신 [끄기]), "피드백과 오류", "문구" 표
- `/docs/ARCHITECTURE.md` — "제약 단일 표현"([이번 기간만 끄기]는 `disabledIds`, 매장 조건 원본은 바꾸지 않는다)
- `/lib/store.ts` — `WorkPeriod.disabledIds`·`ruleOverrides`·`snapshot`, `setDisabled`, `removeRule`(기본 규칙은 `enabled: false`), `enableRule`, `liveShopRules`, 567행 부근의 "확정이면 snapshot, 아니면 shop" 선택 로직, `toScheduleRequest`
- `/lib/store.test.ts` — "이번 기간만 끄기와 제안 수락" describe
- `/components/ConstraintCard.tsx` — `isDefault`·`shopOff`·`off` 배지와 버튼 줄(`끄기`, `이번 근무표에서만 끄기`, `다시 켜기`)
- `/components/RulesStep.tsx` — `renderCard`(②에서는 `onToggleOff`, 매장 설정에서는 없음)
- `/components/ScheduleStep.tsx` — `ScheduleBody`(`constraints`, `SummaryCard` 호출), `SummaryCard`, `OutcomePanel`의 [이번 근무표에서만 끄기]
- `/components/ConfirmedPeriod.tsx` — `ScheduleBody`를 어떻게 쓰는지(확정 근무표도 같은 요약 지표를 쓴다)
- `/lib/wording.ts` — `presetName`, `describeRule`

## 배경

끄기가 두 종류다. ②·매장 설정의 "끄기"는 매장 조건을 **영구히** 끈다(`enabled: false`, 다음 근무표에도 꺼진 채). 근무표 없음 화면과 ② 카드의 "이번 근무표에서만 끄기"는 **이번 근무표만** 끈다(`disabledIds`). 지금은 둘이 비슷한 글자라 매니저가 구분하기 어렵고, 이번 근무표에서 규칙을 끈 채 만들어도 ③ 요약 지표에 "반드시 규칙을 모두 지켰어요"만 보여 꺼진 규칙이 있었다는 사실이 드러나지 않는다.

이 step은 (a) 영구 끄기의 문구를 바꿔 구분하고, (b) 요약 지표에 "이번 근무표에서 끈 규칙" 칸과 목록을 둔다. 끄기 동작 자체(store)는 바꾸지 않는다.

## 작업

TDD: (b)의 순수 함수는 `lib/store.test.ts`에 테스트를 먼저 쓴다.

### (a) 영구 끄기 문구 — `components/ConstraintCard.tsx`
- 기본 규칙(`isDefault`)의 버튼 `끄기` → **`매장 조건에서 끄기`**. `다시 켜기`는 그대로.
- 배지 `꺼짐`(`shopOff`) → **`매장 조건에서 꺼짐`**.
- ②(`onToggleOff`가 있고 `readOnly`가 아닌 매장 규칙 카드)에서는 두 끄기 버튼이 나란히 보인다. 이때 영구 끄기 버튼에 `title="매장 설정에서도 꺼져요. 다음 근무표에도 적용돼요"`를 두고, `shopOff`가 된 직후 카드에 보조 한 줄 `매장 설정에서도 꺼졌어요. 다음 근무표에도 적용돼요`(`ui.help`)를 배지 옆에 둔다. 매장 설정 탭(`onToggleOff` 없음)에서는 이 줄을 두지 않는다(그 화면이 곧 매장 설정이다).
- 순서: 버튼 줄에서 [이번 근무표에서만 끄기]·[다시 켜기] 다음에 [수정], 그다음 [매장 조건에서 끄기]. 기존 순서가 이와 다르면 맞춘다. Danger 스타일([삭제])은 그대로 왼쪽.
- 확인 대화상자는 두지 않는다(되돌릴 수 있다).

### (b) 요약 지표 — `lib/store.ts` + `components/ScheduleStep.tsx`
1. `lib/store.ts`:
   ```ts
   /** 이번 근무표에서 끈 규칙·요청(disabledIds 순). 확정 근무표는 snapshot의 매장 규칙에서, 아니면 shop.rules에서 찾는다. 없는 id는 건너뛴다. */
   export function disabledRulesFor(shop: Shop, period: WorkPeriod): ConstraintSpec[];
   ```
   - 매장 규칙은 `period.ruleOverrides[id] ?? 원본`을 쓴다(이번 근무표의 수정본이 있으면 그것).
   - 요청(`period.requests`)도 포함한다(③ 예외 카드도 [이번 근무표에서만 끄기]가 있다).
   - 테스트: 매장 규칙·요청이 섞인 `disabledIds`가 순서대로 나오는 것, 없는 id 건너뜀, 확정 뒤 snapshot 규칙을 쓰는 것(snapshot에 있고 shop.rules에서 지워진 규칙이 나온다).
2. `components/ScheduleStep.tsx` `SummaryCard`에 선택 prop을 더한다:
   ```ts
   /** 이번 근무표에서 끈 규칙(제목 · 해석 문장). 비어 있으면 칸을 그리지 않는다 */
   disabled?: { name: string; text: string }[];
   ```
   - "결과" 칸: `disabled.length > 0`이면 `반드시 규칙을 모두 지켰어요` 배지 **옆에** 주의 배지 `끈 규칙 {n}개`(`bg-[#FDF0DC] text-[#7A4506]`)를 붙인다. 근무표 없음일 때도 붙인다.
   - 새 칸 **"이번 근무표에서 끈 규칙"**: 값은 `{n}개`(mono), 그 아래 목록은 `text-xs text-[#3D3D38]`로 한 줄에 하나 `{name} · {text}`, 3개까지 보이고 넘치면 `외 {n−3}개`. 칸은 "못 지킨 가능하면 규칙" 뒤, "확정본에서 바뀐 칸" 앞.
   - `ScheduleBody`에서 `disabledRulesFor(shop, period)`를 `presetName`·`describeRule(c, shop.config, employees, period)`로 바꿔 넘긴다(확정 근무표는 `ConfirmedPeriod`가 같은 `ScheduleBody`를 쓰므로 함께 적용된다). `describeRule`에 쓰는 `config`·`employees`는 `ScheduleBody`가 이미 가진 것을 쓴다.
   - 랜딩 히어로(`HeroSequence`)·로그인 화면이 `SummaryCard`를 쓰면 prop을 넘기지 않아 바뀌지 않는다.

## Acceptance Criteria

```bash
npx vitest run lib/store.test.ts
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 끄기 동작(store의 `setDisabled`·`removeRule`·`enableRule`)을 바꾸지 않았는가?
   - 요약 지표의 목록 문장이 `lib/wording.ts`에서 온 것인가(컴포넌트가 문장을 만들지 않는가)?
   - UI_GUIDE "문구" 표의 말만 썼는가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`): ②에서 규칙 하나를 [이번 근무표에서만 끄기] → ③ 근무표 만들기 → 요약 지표에 `끈 규칙 1개` 배지와 "이번 근무표에서 끈 규칙" 칸, 목록 한 줄. 같은 카드의 [매장 조건에서 끄기]를 누르면 배지가 `매장 조건에서 꺼짐`이고 보조 줄이 보인다. 매장 설정 [매장 조건]에서는 보조 줄이 없다.
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**(버튼 "끄기" → "매장 조건에서 끄기", 배지 글자, 보조 줄 문장, 요약 지표의 새 칸 레이블과 배지 글자, 칸 순서). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 끄기에 확인 대화상자를 두지 마라. 이유: [다시 켜기]로 되돌릴 수 있다(UI_GUIDE 원칙 7). 대화상자는 되돌릴 수 없는 동작에만 쓴다.
- `disabledIds`를 매장 조건 원본에 반영하거나 그 반대로 하지 마라. 이유: ARCHITECTURE "제약 단일 표현". 두 끄기는 저장 위치가 다르다.
- "반드시 규칙을 모두 지켰어요" 배지를 끈 규칙이 있을 때 숨기지 마라. 이유: 켜진 규칙은 실제로 모두 지켰다. 끈 규칙이 있다는 배지를 **옆에 함께** 둔다.
- `OutcomePanel`의 [이번 근무표에서만 끄기] 문구를 바꾸지 마라. 이유: 이번 근무표만 끄는 쪽은 이미 분명하다. 바뀌는 쪽은 영구 끄기다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
