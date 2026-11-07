# Step 5: demo-schedule-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — UI는 TDD 대상이 아니다. LLM 출력은 검증된 것만 반영
- `/docs/ARCHITECTURE.md` — "데이터 흐름 › 규칙 입력, 생성, 해 없음", "패턴 › 결정적 대체 경로"
- `/docs/UI_GUIDE.md` — "근무표 작성 ②·③", "해 없음 패널", "대화상자", 문구 규칙
- `/docs/DEMO_SCENARIO.md` — 장면 7~11(② 두 문장 적용 → ③ 해 없음 → 제안 수락 → 근무표 → 확정)
- `/components/ScheduleStep.tsx` — `readAvailability`(링크 행 읽기), `useSolve`(`run`, `runExplain`, 해 없음 분기와 `unsubmittedFor`), `ScheduleStep`의 ③ 진입 effect와 `onConfirm`(`lockAvailabilityLinks` 뒤 `confirm`), [확정] 버튼과 확인 대화상자
- `/components/RulesStep.tsx` — 입력 바 `<form>`과 예시 칩, `COPY`, 카드 목록(`items`)
- `/components/Demo.tsx` — step 3의 `DemoGateDialog`, `useStartOwnShop`
- `/lib/demo.ts`, `/lib/demo-doc.ts` — `demoExplanation(DEMO_DOC, req, inputVersion)`
- `/lib/store.ts` — `demo`, `toScheduleRequest`, `applyChanges`
- `/lib/api.ts` — `solve`, `explain`(체험에서는 `explain`을 부르지 않는다)

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝)을 실제 앱 화면으로 눌러 본다. 자유 입력은 없고 버튼만 누른다. LLM 엔드포인트(`/translate`, `/explain`)는 부르지 않고 솔버(`/solve`)만 실제로 부른다.

체험의 핵심 흐름은 영상(DEMO_SCENARIO 장면 7~10)과 같다: ②에 놓인 대기 카드 2장을 [모두 적용] → ③ [근무표 만들기] → "이 조건으로는 근무표를 만들 수 없어요" → 저장된 설명과 검증된 제안 → [수락] → 근무표. 지금 코드는 해 없음이면 `/explain`을 자동으로 부른다(LLM). 체험에서는 `lib/samples/demo-shop.json`에 저장된 설명을 쓴다. 저장 시점과 규칙 제약이 같을 때만 보여 주고, 다르면 설명 없이 충돌 규칙 목록과 [이번 기간만 끄기]만 보인다(이미 있는 대체 경로).

확정은 직원 링크를 잠그고 서버에 저장하므로 체험에서 막고 [내 매장으로 시작하기]로 안내한다. ②의 말로 적는 입력 바는 체험에서 숨기고 안내 한 줄로 바꾼다.

## 작업

1. **`components/ScheduleStep.tsx`**
   - `readAvailability(periodId)`: 체험이면(`useAppStore.getState().demo`) 링크를 읽지 않고 `false`를 돌려준다. (③ 진입 effect와 `run`, `onConfirm`이 모두 이 함수를 쓰므로 한 곳만 고치면 된다.)
   - `useSolve.run`의 해 없음 분기: 체험이면 `runExplain` 대신 `demoExplanation(DEMO_DOC, req, res.input_version)`을 `explanation`으로 넣는다(null이면 설명 없음). `explaining`은 켜지 않는다. `unsubmittedFor` 검사는 그대로 먼저 한다.
   - `onConfirm`: 체험이면 아무것도 하지 않고 `DemoGateDialog`를 연다. 제목 "확정은 내 매장에서 할 수 있어요", 본문 "확정하면 직원 링크가 잠기고, 직원은 같은 링크에서 근무표를 봐요. 내 매장을 만들면 여기서 만든 것처럼 바로 이어서 할 수 있어요." [확정] 버튼 자체는 체험에서도 보이고 눌린다(막힌 것을 누르면 안내가 뜨는 것이 체험의 목적이다). 기존 "근무표를 확정할까요?" 확인 대화상자는 체험에서 열지 않는다.
   - 제안 [수락](`applyChanges` 뒤 다시 풀기)은 그대로 동작해야 한다. 수락하면 규칙 제약이 바뀌므로 그 뒤 해 없음이 나도 저장된 설명은 더 맞지 않는다(의도한 동작).

2. **`components/RulesStep.tsx`**: `const demo = useAppStore((s) => s.demo)`. 체험이면 입력 바 `<form>`과 예시 칩, `failure`·`notice` 영역 대신 `ui.panel` 안에 한 줄을 둔다: 제목 `ui.cardTitle` "체험에서는 말로 적을 수 없어요", 본문 `text-[13px] text-[#3D3D38]` "카드를 끄고 켜거나 숫자를 바꾸고, ③에서 근무표를 만들어 보세요. 내 매장에서는 문장을 적으면 카드가 돼요.", 오른쪽에 [내 매장으로 시작하기] `ui.textSm`(`useStartOwnShop`). `summary`(요약표), `afterInput`(필요 인원 숫자 폼 — LLM을 쓰지 않으므로 그대로), 카드 목록, [모두 적용]은 체험에서도 그대로다. scope `period`(이번 근무표 예외)도 같은 안내를 쓴다.
   - `COPY`의 문구와 체험이 아닐 때의 렌더는 바꾸지 않는다.

3. 수동 확인(가능하면): `/demo` ②에서 대기 카드 2장을 [모두 적용] → ③ → [근무표 만들기] → "이 조건으로는 근무표를 만들 수 없어요"와 제안 카드([수락] 버튼)가 뜨고, 개발자 도구 네트워크에 `/api/py/explain` 요청이 없는지 → [수락] → 근무표와 "반드시 규칙을 모두 지켰어요" → [확정] → "확정은 내 매장에서 할 수 있어요" 대화상자. 확인했으면 summary에 적고, 못 했으면 "수동 체크: 확인 못 함"이라고 적는다.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 체험에서 `explain`·`translate`·`lockAvailabilityLinks`·`loadAvailabilityLinks`·`confirm`이 불리는 경로가 없는가?
   - 저장된 설명을 `demoExplanation`의 signature 검사 없이 보여 주는 곳이 없는가?
   - 체험이 아닐 때의 코드 경로와 문구가 그대로인가?
   - 화면 문구에 개발 용어가 없는가(UI_GUIDE "문구")?
   - `lib/`·`backend/`가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(바뀐 컴포넌트와 분기, 체험 문구, 수동 체크 결과)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 체험에서 `/explain`을 "횟수 제한"으로라도 부르지 마라. 이유: 이 phase의 전제는 체험이 LLM 비용을 쓰지 않는 것이다(ADR-022가 영상으로 물러난 이유).
- 저장된 설명을 요청과 비교하지 않고 보여 주지 마라. 이유: 카드를 끈 뒤의 해 없음에 엉뚱한 제안이 붙는다. 제안은 재풀이로 검증된 것만 보여 준다는 원칙(ARCHITECTURE)과 어긋난다.
- 체험에서 [확정] 버튼을 숨기거나 비활성화하지 마라. 이유: 눌렀을 때 안내가 뜨는 것이 CTA다.
- `lib/store.ts`의 `confirm`을 체험 분기로 바꾸지 마라. 이유: 화면에서 막는다.
- 랜딩을 고치지 마라. 이유: step 6이 한다.
- 기존 테스트를 깨뜨리지 마라.
