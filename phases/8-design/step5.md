# Step 5: rule-cards

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — 원칙 2 "말이 인터페이스다"
- `/docs/UI_GUIDE.md` — "컴포넌트 › 입력 필드 › 자연어 입력 바 · 규칙·요청 카드 — 답장처럼 · 제안 카드 · 배지 · 반드시/가능하면 토글 · 반복 사용 컴포넌트 › 꺼진 규칙·요청 카드", "화면 구조 › 근무표 작성 › ② 매장 조건", "문구"
- `/docs/PRD.md` — "핵심 기능 1"
- `/components/ui.ts`, `/components/Wordmark.tsx`(`Mark`)
- `/components/ConstraintCard.tsx` — 카드와 설정 변경 카드(`ShiftChangeCardView`)
- `/components/RuleText.tsx` — 해석 문장과 조정 가능한 값 밑줄
- `/components/RulesStep.tsx` — ② 매장 조건의 입력 바·예시·숫자 입력·카드 목록(`Spinner`도 여기 있다)
- `/components/ShopSettings.tsx` — [매장 조건] 탭이 `RulesStep`을 어떻게 쓰는지(읽기만)
- `/components/HeroSequence.tsx` — step 2가 정적으로 그린 답장 형태 카드(같은 모양으로 맞춘다)
- `/e2e/test-helpers.ts` — `pendingCards`, `appliedCards`, `expectCardChrome`, `interpret`가 카드를 어떻게 찾는지

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 규칙·요청 카드는 ②, ③의 예외, 확정 근무표의 변경, 매장 설정 [매장 조건]에서 모두 쓰는 공용 컴포넌트다. 이 step은 카드를 "답장 형태"로 바꾸고 ②의 입력 바를 강조 바탕 패널로 올린다. 카드의 상태·버튼·동작(적용, 수정, 삭제, 끄기, 중요도)은 그대로다.

## 작업

1. `ConstraintCard.tsx`를 UI_GUIDE "규칙·요청 카드 — 답장처럼" 구조로 바꾼다.
   - 위에서부터: 제목(`text-[15px] font-semibold`, `presetName`) + 오른쪽 토글(+ 중요도 select) → 원문(`<Mark>`가 아니라 따옴표 글리프만: 청록 따옴표 path SVG 20px + `text-[15px]`. 따옴표 문자 “ ” 삭제) → 해석(`ml-2 border-l-2 border-[#CFE4EA] pl-3.5`: `ui.eyebrow` 11px "이렇게 읽었어요" + `RuleText` 문장 `text-sm text-[#1B1B18]` + 예시 판정 영역) → 배지 + 버튼 줄.
   - 패딩 `px-5 py-[18px]`, 안 간격 `gap-3.5`. 적용 대기는 테두리 `border-[#C9C9C1]`. 꺼진 카드는 원문·해석을 `text-[#66665E]`로.
   - 수정 모드(값 입력 + [저장]/[취소]), 설정 변경 카드, 딸린 카드 들여쓰기, 예시 판정 접기는 동작 그대로 두고 스타일만 맞춘다.
   - `article` 요소, "적용 대기"/"적용됨" 배지 글자, 버튼 레이블(적용·수정·삭제·끄기·다시 켜기)은 바꾸지 않는다(e2e가 찾는다).
2. `RulesStep.tsx`의 입력 영역을 `ui.panel`로 옮긴다: 제목 "매장 조건을 말로 적어 주세요"(15px) + 설명 "근무 형태, 필요 인원, 지켜야 할 규칙 모두 한 곳에서요." + `ui.bar`(마크 18 + `ui.barInput` + [규칙 만들기] `ui.primaryBar`) + 예시 줄("예시" 보조 + `ui.chip` 3개, 누르면 입력에 채움). 입력의 `<label>`은 sr-only로 남긴다(e2e `interpret`가 이름으로 찾는다). 진행 중에는 버튼이 "읽는 중…" + `Spinner`.
   - 접힌 "숫자로 입력하기"와 요약표, [모두 적용]은 위치와 동작 그대로.
   - 매장 설정 [매장 조건] 탭은 같은 `RulesStep`을 쓰므로 자동으로 바뀐다. `ShopSettings.tsx`는 고치지 않는다.
3. 제안 카드(해 없음 패널 안, `ScheduleStep.tsx`의 `OutcomePanel`이 그린다면 **이 step에서 건드리지 않고** step 6에서 맞춘다. `ConstraintCard.tsx`에 있다면 UI_GUIDE "제안 카드" 규격으로 맞춘다).

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: 카드의 상태 전이(대기 → 적용 → 수정/삭제/끄기)와 store 호출을 바꾸지 않았는가? `RuleText`가 만드는 문장을 LLM 문장으로 바꾸지 않았는가(UI_GUIDE "해석 결과는 lib/wording.ts가 식에서 만든 문장")?
3. 수동 저니 체크리스트(`npm run dev`, 1440px, Anthropic 키 필요):
   - ②에서 "마감 다음 날 오픈은 안 되게" 입력 → 강조 패널 아래 답장 형태 카드가 `적용 대기`로 생긴다. 예시 칩을 누르면 입력에 채워진다.
   - [적용] → 배지 `적용됨`, 카드 위치 그대로. [수정] → 값 입력이 펼쳐진다. [삭제] → 즉시 사라진다.
   - 매장 설정 [매장 조건] 탭에서도 같은 모양이고 `기본` 배지 카드는 [끄기]다.
   - 꺼진 카드는 보조 색이고 [다시 켜기]가 있다.
   - 카드 안 Primary는 [적용] 하나다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 바뀐 DOM 구조 중 e2e에 영향 줄 수 있는 것)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 카드 배지 글자·버튼 레이블·`article` 요소를 바꾸지 마라. 이유: e2e 헬퍼가 그 글자로 카드를 찾는다. 바꿔야 하면 summary에 적고 step 10에서 고친다.
- 해석 문장을 LLM 출력으로 바꾸지 마라. 이유: CLAUDE.md CRITICAL(검증된 식에서 결정적으로 만든다).
- `ScheduleStep.tsx`, `ConfirmedPeriod.tsx`, `ShopSettings.tsx`를 고치지 마라. 이유: step 6·7·9의 범위.
- 기존 테스트를 깨뜨리지 마라.
