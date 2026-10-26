# Step 12: ui-schedule

## 읽어야 할 파일

- `/CLAUDE.md`, `/AGENTS.md`
- `/docs/PRD.md` (저니 ④⑥⑦, 핵심 기능 5의 통계와 CSV), **`/docs/UI_GUIDE.md`** (근무 코드, 근무 셀, 요약 지표, 레이아웃, 애니메이션)
- `/lib/store.ts`, `/lib/api.ts`, `/lib/types.gen.ts`, `/app/app/page.tsx`, `components/` (step 10, 11)

## 작업

④ 근무표 화면의 생성, 그리드, 통계, 수동 조정, 확정, CSV를 만든다. `lib/csv.ts`는 **테스트를 먼저** 작성한다.

### 1. `lib/csv.ts` (+ `lib/csv.test.ts` 먼저)
```ts
toScheduleCsv(input: { nurses, period, holidays, assignments, stats }): string
```
- 첫 행: 이름, 연차, 1~말일의 요일(일/월/…), D, E, N, O, 주말근무
- 둘째 행: 날짜 숫자
- 간호사 행: 이름, 연차, 근무 코드들, 합계
- 하단 3행: 날짜별 D/E/N 합계
- 앞에 UTF-8 BOM(`﻿`), 줄바꿈은 CRLF
- 쉼표, 따옴표, 줄바꿈이 있는 셀은 RFC 4180으로 이스케이프한다. `= + - @`로 시작하는 셀은 앞에 `'`를 붙인다(수식 인젝션 방지).

### 2. ④ 근무표 화면
- **[생성]**: `api.solve`(store 전체 → ScheduleRequest, `previous`는 확정본이 있을 때만). 풀이 중에는 버튼 텍스트를 "푸는 중…"으로 바꾸고 스피너 하나를 둔다.
- **요약 지표 카드**(UI_GUIDE "요약 지표"): 해 상태, 희망 반영 n/m, soft 위반 수(주의색). `optimal=false`이면 "최적이 아닐 수 있음" 배지를 띄운다.
- **근무표 그리드**(UI_GUIDE "근무 셀"과 행 그리드)
  - 날짜 헤더: 일요일·공휴일은 빨강, 토요일은 청록
  - 주말·공휴일 열은 배경색을 넣는다.
  - 셀은 `<button>`이고 `aria-label="{이름} {월}월 {일}일 {코드}"`
  - 표 하단에 날짜별 D/E/N 합계, 오른쪽에 개인별 D/E/N/O 합계
  - `overflow-x-auto` 상자 안에 둔다.
  - soft 위반 칸은 주의 표시(UI_GUIDE 주의색 계열의 작은 표시)
- **개인별 통계 표**: D/E/N/O, 주말·공휴일 근무, 최대 연속 근무, 희망 반영률, 평균 대비 편차
- **수동 조정**: 셀 클릭 → 근무 코드 선택(D/E/N/O) → 그 칸에 `fixed_assignment` 제약을 추가하고(source_text 예: "수동 고정: 이영희 11/5 D", 같은 칸의 기존 고정은 교체) 자동으로 재풀이한다. 이전 결과를 `previous`로 보내 최소 변경으로 푼다.
  - 고정 칸에는 자물쇠 SVG를 표시하고, 다시 클릭하면 [고정 해제]를 할 수 있다.
- **확정**: [확정] → `confirmed`에 현재 assignments를 저장한다. [CSV 다운로드](파일명 `근무표-YYYY-MM.csv`)
- **결과가 infeasible이나 timeout일 때**: 이 step에서는 "해가 없습니다" / "시간 안에 풀지 못했습니다" 상태 표시만 한다. 충돌 패널은 step 13에서 만든다.

## Acceptance Criteria

```bash
npx vitest run
npm run build && npm run lint
uv run pytest backend/tests -q
```

`csv.test.ts`는 최소한 BOM, CRLF, 요일 행, 합계 행, 이스케이프, 수식 인젝션 방지, 31일 달을 다룬다.

## 검증 절차

1. AC를 실행한다.
2. 수동 확인: `npm run dev` → 샘플 병동 불러오기 → ④ 생성 → 그리드와 통계 표시 → 셀 고정 후 재풀이 → 확정 → CSV 다운로드를 확인한다. 이 흐름은 LLM을 쓰지 않는다. 확인 후 서버를 종료한다.
3. UI_GUIDE의 셀 크기(30px 미만 금지)와 색 규칙을 확인한다.
4. `phases/1-mvp/index.json`의 step 12를 업데이트한다.

## 금지사항

- 차트나 표 라이브러리를 추가하지 마라. 이유: 기술 스택 금지 목록(ARCHITECTURE).
- 셀을 30px보다 작게 만들거나 표를 축소하지 마라. 이유: UI_GUIDE 레이아웃 규칙.
- 기존 테스트를 깨뜨리지 마라.
