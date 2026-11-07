# Step 4: ui-rules-settings

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/docs/UI_GUIDE.md`** ("병동 설정", "배지", "반드시/가능하면 토글", "규칙·요청 카드", "반복 사용 컴포넌트"의 꺼진 카드·제외된 간호사, "피드백과 오류", "문구")
- `/lib/wording.ts` (step 2: `TEMPLATE_NAMES`, `hardnessLabel`, `describeParams`, `unitName`, `wardRuleCount`)
- `/lib/store.ts` (`applyRule`, `applyRequest` 등 카드 액션, `pendingRules`/`rules`, `pendingRequests`/`requests`, 명단 액션, `isNurseUsed`)
- `/components/ConstraintCard.tsx`, `/components/RulesStep.tsx`, `/components/WardSettings.tsx`, `/components/RosterEditor.tsx`, `/components/CoverageForm.tsx`, `/components/ui.ts`

## 배경

UX 점검에서 규칙·요청 카드와 병동 설정 화면의 문구가 개발 용어였고(hard/soft, 해석, 변환, 비활성으로, 기간 단위, 달력 월), 카드를 하나씩 적용해야 하며 적용하면 카드 위치가 바뀌었다. 명단 줄마다 [삭제]와 [비활성으로]가 나란히 있어 차이를 알 수 없었다. 이 step은 **카드와 병동 설정**만 고친다.

## 작업

### 1. 규칙·요청 카드 (`ConstraintCard.tsx`)
- 토글 글자 "반드시" / "가능하면"(`hardnessLabel`). `hard`/`soft` 글자를 화면에 남기지 않는다.
- 템플릿 이름과 해석 결과는 `lib/wording.ts`를 쓴다. 해석 결과는 mono가 아닌 본문 글꼴(날짜·숫자만 mono 허용, UI_GUIDE "규칙·요청 카드").
- 배지: `적용 대기`, `적용됨`, `이번 근무표에서 꺼짐`. 버튼 [이번 근무표에서만 끄기] / [다시 켜기].
- 수정 폼의 레이블도 문구 표를 따른다("오프" → "휴무", "기간 전체" → "근무표 전체").

### 2. 자연어 입력과 카드 목록 (`RulesStep.tsx`)
- 버튼: 병동 규칙 탭은 [규칙 만들기], 요청 단계는 [요청 만들기]. 진행 중 "읽는 중…".
- 병동 규칙 탭: 입력 바 아래 예시 2~3개를 Text 버튼으로 두고 누르면 입력 바에 채운다(예: "나이트 다음 날은 무조건 쉬게", "3년차 이상이 매 근무 1명은 있게").
- 적용 대기 카드가 2개 이상이면 목록 위에 [모두 적용] Secondary.
- **카드 순서 유지**: 적용해도 카드는 제자리에서 배지와 버튼만 바뀐다. 새 카드는 맨 위. 지금은 대기 목록과 적용 목록이 따로라 적용하면 옮겨 간다. 해결 방법은 재량이다. store에 순서 정보를 더해야 하면 `lib/store.test.ts`에 테스트를 먼저 추가한다(TDD).
- 요청 단계의 "이 기간에 적용될 병동 규칙 N개"는 `wardRuleCount`로 세고 "이 근무표에 적용되는 병동 규칙 N개"로 쓴다.
- "적용하지 않은 카드 N개는 근무표에 반영되지 않아요" 같은 기존 안내는 문구 표에 맞춰 유지한다.

### 3. 병동 설정 (`WardSettings.tsx`, `RosterEditor.tsx`, `CoverageForm.tsx`)
- "기간 단위" → "근무표 주기", 옵션 `unitName`. 변경 배너 문구는 UI_GUIDE "병동 설정".
- 명단 표 위에 "바꾼 내용은 바로 저장돼요".
- 제외된 간호사(UI_GUIDE "반복 사용 컴포넌트"): `제외` 배지, "제외된 간호사 N명 보기", 행 동작 [근무표에서 빼기] / [다시 넣기]와 "빼도 지난 근무표와 통계에는 남아요" 한 줄.
- [삭제]는 `isNurseUsed`가 false인 간호사에게만, 행 끝 메뉴(⋯ 버튼, `aria-label="{이름} 더 보기"`) 안에 둔다. [근무표에서 빼기]와 나란히 두지 않는다.
- 붙여넣기 버튼 [변환] → [표로 만들기].
- "나이트 전담" 열 이름 유지(N전담 금지).

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
! grep -rnE '>\s*(hard|soft)\s*<|"해석"|"변환"|비활성으로|기간 단위|달력 월' components/ConstraintCard.tsx components/RulesStep.tsx components/WardSettings.tsx components/RosterEditor.tsx components/CoverageForm.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(grep은 화면 글자만 잡도록 필요하면 패턴을 좁혀도 된다. 내부 값 `"hard"`/`"soft"` 문자열은 허용).
2. 수동 확인: `npm run dev` → 샘플 → 병동 설정 두 탭, 요청 단계에서 카드 2개 해석 → [모두 적용] → 순서가 그대로인지, 명단 메뉴의 [삭제]가 사용된 간호사에게 안 보이는지 확인한다. 확인 후 서버를 종료한다.
3. UI_GUIDE 체크: 영역마다 Primary 하나, Danger가 Primary 옆에 붙지 않음, 토스트 없음.
4. 결과에 따라 `phases/3-ux/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 기간 작업(①②③의 레이아웃, 근무표, 통계), 홈, 시작 화면을 바꾸지 마라. 이유: step 5·6의 범위다. 단 `RulesStep`이 ② 요청에서도 쓰이므로 그 안의 입력 바·카드 목록 변경은 이 step에서 한다.
- 데이터 이름과 API 값(`hardness: "hard"` 등)을 바꾸지 마라. 이유: 화면 문구만 바꾼다.
- 기존 테스트를 깨뜨리지 마라.
