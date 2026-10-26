# Step 11: ui-rules-requests

## 읽어야 할 파일

- `/CLAUDE.md`, `/AGENTS.md`
- `/docs/PRD.md` (저니 ②③), **`/docs/UI_GUIDE.md`** (입력 필드, 배지, hard/soft 토글, 규칙·요청 카드)
- `/lib/store.ts`, `/lib/api.ts`, `/lib/roster-import.ts`, `/lib/types.gen.ts` (step 10)
- `/app/app/page.tsx`와 step 10에서 만든 `components/`

## 작업

② 병동 규칙, ③ 이달 요청 화면을 만든다(UI 컴포넌트는 TDD 대상 아님).

### ② 병동 규칙 / ③ 이달 요청 (같은 컴포넌트, scope만 다름)
- **자연어 입력 바**: UI_GUIDE "입력 필드"를 따른다. 1000자를 넘으면 버튼을 비활성화하고 글자 수를 표시한다.
  - placeholder 예: ② "예: 나이트 다음 날은 무조건 쉬게", ③ "예: 이영희 15~17일 휴가"
- [해석] → `api.translate`(scope, context: nurses·period·holidays·today). 요청 중에는 버튼 비활성과 "해석 중…"을 표시한다.
- **응답별 표시**
  - `ok` → 제안 카드(적용 대기)를 `pendingCards`에 추가한다.
  - `clarify` → 입력 바 아래에 질문을 표시한다. 사용자가 답을 보완해 다시 입력한다.
  - `unsupported` → "아직 지원하지 않는 규칙이에요: {reason}" 안내
  - 오류 → `api.ts`의 문구로 토스트와 [다시 시도]
- **카드**(UI_GUIDE "규칙·요청 카드")
  - 템플릿 이름(한국어 표시명 매핑을 컴포넌트에 둔다)과 hard/soft 토글을 둔다. 휴가와 고정 배정은 토글을 비활성화하고 항상 hard다.
  - 원문 인용(source_text)
  - 해석 결과(mono, 예: "n03 이영희 · 11/15~11/17 · O")
  - 상태 배지(적용 대기 / 적용됨)와 버튼(대기: 삭제·적용 / 적용됨: 수정·삭제)
  - 같은 type·scope·대상의 기존 카드가 있으면 "기존 규칙 대체" 표시
  - 명단에 없는 간호사를 참조하면 ⚠ 표시(경고 아이콘 SVG)
  - **수정**: params를 간단한 폼(숫자, 날짜 목록, 근무 코드 select)으로 편집한다. 저장하면 `inputVersion`이 증가한다.
- **③ 화면 추가 요소**: 전월 이월 붙여넣기 영역(선택). `parseCarryOver` 결과로 경고와 오류를 표시한다.
- [이전]/[다음]. ④로 넘어갈 때 고아 제약이 있으면 막고 안내한다.

## Acceptance Criteria

```bash
npm run build && npm run lint
npx vitest run
uv run pytest backend/tests -q
```

## 검증 절차

1. AC를 실행한다.
2. 수동 확인: `npm run dev` → ②에서 입력 → 카드 → 적용 흐름을 확인한다.
   - 키가 `.env.local`에 있으면 실제 API로 1~2회만 확인한다.
   - 키가 없거나 호출이 실패하면, 오류 토스트가 뜨는지만 확인한다.
   - 확인 후 서버를 종료한다.
3. UI_GUIDE 안티패턴을 확인한다(이모지 금지 → 자물쇠·경고는 SVG).
4. `phases/1-mvp/index.json`의 step 11을 업데이트한다.

## 금지사항

- 카드 [적용] 없이 LLM 결과를 `constraints`에 직접 넣지 마라. 이유: 결정은 사람이 한다(ADR-004, UI_GUIDE 원칙 2).
- 실제 API를 반복 호출하지 마라(수동 확인 1~2회만). 이유: 비용.
- `.env.local`을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라.
