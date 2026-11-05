# Step 6: confirm-dialog

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/UI_GUIDE.md` — "반복 사용 컴포넌트 › 대화상자", "피드백과 오류 › 되돌릴 수 없는 동작만 확인", "제안 카드", "근무표 작성 › ③ 근무표의 버튼", "접근성 › 키보드"
- `/docs/PRD.md` — J2 ③ "[확정]하면 … 직원 링크는 잠긴다", J4 "확정한 뒤에는 근무표 작성으로 돌아가지 않는다"
- `/components/Dialog.tsx` — 공용 대화상자(제목, 본문, secondary·primary, Esc, 포커스 되돌리기)
- `/components/Account.tsx` — `Dialog`를 쓰는 기존 예(데이터 삭제 2단계)
- `/components/ScheduleStep.tsx` — `ScheduleStep`의 `onConfirm`(가능 시간 다시 읽기 → 링크 잠금 → `confirm`), [확정] 버튼(`disabled={busy || blocked || outdated}`), `ProposalCard`([수락]), `OutcomePanel`
- `/components/ConfirmedPeriod.tsx` — [다시 확정](이 step에서 바꾸지 않는다)
- `/lib/store.ts` — `applyChanges`(제안 수락이 `disabledIds`·`ruleOverrides`·요청만 바꾸고 매장 조건 원본은 그대로라는 근거)

## 배경

③의 [확정]은 되돌릴 수 없다. 직원 링크가 잠기고, 이후 변경은 확정 근무표의 변경 입력으로만 할 수 있다. 지금은 한 번 누르면 바로 확정된다. 이 step은 기존 `Dialog`로 확인을 받는다. 같은 step에서 근무표 없음 패널의 제안 [수락]에 "이번 근무표에만 적용돼요. 매장 조건은 그대로예요" 안내를 붙인다(수락이 매장 조건을 바꾸는 것으로 오해하기 쉽다).

## 작업

1. `components/ScheduleStep.tsx` `ScheduleStep`:
   - 상태 `confirmOpen`을 두고 [확정] 버튼은 `onConfirm` 대신 대화상자를 연다. 비활성 조건(`busy || blocked || outdated`)은 그대로.
   - 대화상자: `Dialog` 사용. 제목 **"근무표를 확정할까요?"**, 본문 두 줄 `확정하면 직원 링크가 잠겨요.` / `이후 변경은 변경 입력으로만 할 수 있어요.`, secondary **[취소]**(닫기), primary **[확정]**(`onConfirm()` 호출 뒤 닫기). `danger`는 쓰지 않는다. Esc는 닫기.
   - 대화상자가 열린 동안 `onConfirm`이 진행 중이면(`confirming`) primary를 비활성으로 하고 레이블은 "확정하는 중…"으로 한다(두 번 보내지 않게). 실패하면 기존 `ToastAlert`가 뜨고 대화상자는 닫혀 있다(토스트의 [다시 시도]는 대화상자 없이 `onConfirm`을 다시 부른다 — 이미 한 번 확인했다).
   - 닫히면 포커스가 [확정] 버튼으로 돌아온다(`Dialog`가 한다. 확정이 성공하면 화면이 확정 근무표로 바뀌므로 상관없다).
   - 같은 이름의 버튼이 둘이 되는 것(화면 [확정], 대화상자 [확정])은 e2e 동기화(마지막 step)가 처리한다. 대화상자의 primary 이름을 "확정"에서 바꾸지 않는다(UI_GUIDE 버튼 레이블: 일어나는 일을 동사로).
2. `components/ScheduleStep.tsx` `ProposalCard`: 검증 결과 줄("이렇게 바꾸면 근무표를 만들 수 있어요 · 희망 반영 …") 아래에 `text-xs text-[#66665E]`로 **`이번 근무표에만 적용돼요. 매장 조건은 그대로예요`** 한 줄을 둔다. 버튼 줄은 그대로([무시] Text + [수락] Primary).
3. `ConfirmedPeriod`의 [다시 확정]에는 대화상자를 두지 않는다(링크가 이미 잠겨 있고 [변경 취소]가 있다).

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `onConfirm`의 순서(가능 시간 다시 읽기 → 링크 잠금 → `confirm`)를 바꾸지 않았는가?
   - 대화상자가 `role="dialog"`, `aria-modal`, Esc, 포커스 복귀를 갖는가(`Dialog` 재사용으로 자동)?
   - UI_GUIDE "문구" 표의 말만 썼는가?
3. 수동 체크(`npm run seed` 뒤 `npm run dev`): ③에서 근무표를 만든 뒤 [확정] → 대화상자 → [취소]면 그대로, Esc도 그대로, [확정]이면 확정 근무표 화면. 근무표 없음 패널의 제안 카드에 안내 줄이 보인다(제안이 안 뜨면 e2e S18 시나리오의 매장으로 만들거나 summary에 "확인 못 함"을 적는다).
4. 결과에 따라 `phases/9-rules-and-confirm/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. **바뀐 화면 문구·접근성 이름·버튼 위치를 적어라**(대화상자 제목·본문·버튼 이름, "확정" 이름 버튼이 둘이 되는 것, 제안 카드의 새 줄). 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 대화상자를 새로 만들지 마라. 이유: `components/Dialog.tsx`가 UI_GUIDE 규격(그림자, Esc, 포커스)을 이미 지킨다.
- 대화상자 버튼을 셋 이상 두거나 "확인"·"OK" 같은 레이블을 쓰지 마라. 이유: UI_GUIDE "대화상자의 버튼은 두 개까지", "레이블은 동사".
- [다시 확정], [수락], [이번 근무표에서만 끄기]에 확인을 붙이지 마라. 이유: 되돌릴 수 있는 동작은 묻지 않는다(UI_GUIDE 원칙 7).
- `components/Dialog.tsx`를 고치지 마라. 이유: 데이터 삭제 대화상자가 함께 바뀐다. 필요한 변경이 있으면 summary에 적어라.
- `scripts/record-dining.ts`(데모 영상 녹화)를 이 step에서 고치지 마라. 이유: 영상 스크립트의 [확정] 클릭 수정은 마지막 step(e2e-sync)이 함께 한다.
- `npm run test:e2e`를 돌리지 마라. 이유: e2e 동기화는 마지막 step이 한다.
- 기존 테스트를 깨뜨리지 마라.
