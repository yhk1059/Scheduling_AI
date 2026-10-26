# Step 13: ui-conflicts-changes

## 읽어야 할 파일

- `/CLAUDE.md`, `/AGENTS.md`
- `/docs/PRD.md` (저니 ⑤⑧), `/docs/ARCHITECTURE.md` (데이터 흐름의 "해 없음", 상태 관리의 stale 처리), **`/docs/UI_GUIDE.md`** (제안 카드, 카드의 해 없음 패널, 배지, 변경된 칸, 월중 변경 배너)
- `/lib/store.ts`, `/lib/api.ts`, `/lib/types.gen.ts`, `/app/app/page.tsx`, `components/` (step 10~12)

## 작업

④ 화면에 충돌 대응, 월중 변경, stale 처리, 오류 처리를 추가한다(UI 컴포넌트는 TDD 대상 아님. store에 로직을 추가하면 `lib/store.test.ts`에 테스트를 먼저 추가한다).

### 1. 해 없음 패널 (UI_GUIDE의 해 없음 패널 테두리, `해 없음` 배지)
- `solve`가 `infeasible`이면 자동으로 `api.explain`을 호출한다. 그동안 "원인을 분석하는 중…"을 표시한다.
- 설명 텍스트를 보여주고, `fallback=true`이면 "자동 설명을 만들지 못해 충돌 규칙만 표시합니다"를 덧붙인다.
- **제안 카드**(UI_GUIDE "제안 카드"): 제목, `검증됨` 배지, 설명, 재풀이 결과(예: "재풀이 결과 · 해 있음 · 희망 반영 14/16"), [무시], [수락]
  - [수락] → changes를 store 제약에 적용(`disable` → `enabled=false`, `update` → params/hardness 교체)하고 자동으로 재풀이한다.
- **충돌 규칙 목록**: 각 conflict의 원문과 [이번 달만 끄기]. 누르면 `enabled=false`로 바꾸고 재풀이한다. 제안이 0개이거나 fallback일 때도 항상 보인다.
- `conflicts`가 비었으면 "원인을 특정하지 못했어요. 규칙을 하나씩 꺼서 확인해 주세요"를 표시하고, hard 제약 전체 목록에 끄기 토글을 둔다.
- `timeout`이면 "시간 안에 풀지 못했어요"를 표시하고 같은 끄기 목록을 보여준다.

### 2. 월중 변경
- 확정본(`confirmed`)이 있을 때 ④ 상단에 월중 변경 입력 바를 둔다(예: "최지훈 이번 주 병가").
- `api.translate`(scope "month") → 제안 카드 → [적용] → `previous=confirmed`로 재풀이한다.
- 결과에서 `diff` 칸을 "변경됨" 스타일(UI_GUIDE)로 하이라이트하고, 배너에 "{n}명, {m}칸 변경"을 표시한다.
- 새 결과는 "초안" 배지를 달고, [확정]하면 확정본을 교체한다.

### 3. stale 처리와 오류 처리
- 응답의 `input_version`이 현재 store의 `inputVersion`과 다르면 결과 위에 "입력이 바뀌었어요. 다시 생성하세요" 배지와 [다시 생성]을 띄운다.
- 모든 API 오류는 `api.ts` 문구로 토스트를 띄우고 [다시 시도]를 둔다. 자동 재시도는 하지 않는다.
- 요청 중에는 관련 버튼을 비활성화한다(중복 클릭 방지).

## Acceptance Criteria

```bash
npx vitest run
npm run build && npm run lint
uv run pytest backend/tests -q
```

## 검증 절차

1. AC를 실행한다.
2. **수동 저니 확인** (`npm run dev`, 키가 있으면 실제 API는 최소 횟수로)
   1. 샘플 병동 → 규칙과 요청 적용 → 생성
   2. 휴가를 과도하게 추가해 해 없음 → 설명과 제안 → 수락 → 해결
   3. [이번 달만 끄기] 경로
   4. 확정 → 월중 변경 → 변경 칸 하이라이트
   5. 입력 변경 후 stale 배지

   키가 없거나 LLM 호출이 실패하면, explain 대체 경로(fallback)가 표시되는지 확인한다. 확인 후 서버를 종료한다.
3. `phases/1-mvp/index.json`의 step 13을 업데이트한다.

## 금지사항

- 검증되지 않은 제안(재풀이를 안 거친 것)을 표시하지 마라. 이유: UI_GUIDE "제안 카드", ADR-004.
- 실패한 요청을 자동으로 재시도하지 마라. 이유: 엣지 케이스 원칙(사용자가 [다시 시도]를 누른다).
- 다중 탭 동기화를 만들지 마라. 이유: 범위 밖이다.
- 기존 테스트를 깨뜨리지 마라.
