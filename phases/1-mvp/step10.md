# Step 10: ui-shell-ward

## 읽어야 할 파일

- `/CLAUDE.md`, `/AGENTS.md` (Next.js 16은 기존 지식과 다르다. `node_modules/next/dist/docs/`의 관련 문서를 읽고 작업하라)
- `/docs/PRD.md` (저니 ①), `/docs/ARCHITECTURE.md` (상태 관리, 디렉토리), **`/docs/UI_GUIDE.md` 전체**
- `/lib/types.gen.ts`, `/lib/samples/ward-15.json`
- `/backend/domain/models.py` (필드 의미 확인용)
- `/app/layout.tsx`, `/app/page.tsx`, `/app/globals.css`, `/next.config.ts`, `/package.json`

## 작업

앱 셸(`/app`), 상태 저장소, API 래퍼, ① 병동 화면을 만든다. `lib/`의 순수 함수는 **테스트를 먼저** 작성한다(TDD 가드 훅이 테스트 없는 `lib/*.ts` 작성을 막는다).

### 1. 테스트 환경
- `vitest`를 devDependency로 추가한다. `package.json`의 `test` 스크립트를 `uv run pytest backend/tests scripts/test_hooks.py && vitest run`으로 바꾼다.
- `zustand`를 dependency로 추가한다.

### 2. 글꼴과 전역 스타일
- `next/font/google`로 IBM Plex Sans KR(본문)과 IBM Plex Mono(숫자·코드)를 설정한다.
- UI_GUIDE의 페이지 배경과 텍스트 색을 `globals.css`와 `layout.tsx`에 반영한다.
- 기존 다크 모드 미디어쿼리는 제거한다(라이트 전용).

### 3. `lib/roster-import.ts` (+ `lib/roster-import.test.ts` 먼저)
```ts
parseDelimited(text: string): string[][]                       // 탭 우선, 탭 없으면 쉼표. RFC 4180(따옴표, 셀 내 줄바꿈)
mapHeaders(header: string[]): { mapping: Partial<Record<"name"|"years"|"night_only", number>>, unmatched: string[] }
buildRoster(rows: string[][], mapping, firstRowIsData: boolean): { nurses: Nurse[], errors: CellError[] }
parseCarryOver(text: string, nurses: Nurse[]): { rows: CarryOverRow[], warnings: string[], errors: CellError[] }
```
- 헤더 동의어: 이름/성명/간호사 → name, 연차/경력/년차 → years, 나이트전담/N전담/나이트 → night_only
- 동명이인은 행 오류다. "3년차", "3년"은 숫자만 추출하고, 실패하면 셀 오류다.
- 나이트 전담 값은 Y/N/O/X/예/아니오/true/false/빈칸을 정규화하고, 빈칸은 false다.
- 0명 또는 40명 초과면 오류다. id는 "n01"부터 순서대로 부여한다.
- 이월: 명단에 없는 이름은 무시하고 경고, 7일 초과면 마지막 7일만 쓴다.
  - 근무 코드 동의어: OFF/휴/오프 → O, 데이 → D, 이브/이브닝 → E, 나/나이트 → N. 실패하면 셀 오류다.

### 4. `lib/store.ts` (+ `lib/store.test.ts` 먼저)
- Zustand + persist(localStorage, 키 `nurse-scheduler`, `version: 1`)
- 상태
  - `step`(1~4)
  - `period`, `holidays`, `nurses`, `constraints`(적용된 것), `pendingCards`(제안 대기)
  - `carryOver`
  - `result`, `confirmed`(확정본 assignments)
  - `inputVersion`
  - `storageAvailable`
- 액션
  - 병동/제약/이월을 바꾸는 모든 액션은 `inputVersion`을 1 증가시킨다.
  - `applyCard`: 같은 type·scope·대상(nurse_id 또는 shift·day_kind)의 기존 제약이 있으면 교체한다.
  - `orphanConstraintIds()`: 명단에 없는 nurse_id를 참조하는 제약 id 목록을 반환한다.
  - `loadSample()`: 샘플 JSON을 불러온다.
- persist 버전이 다르거나 파싱에 실패하면 초기 상태로 되돌리고 `resetNotice`를 true로 둔다.
- localStorage 접근이 예외를 던지면 메모리로 동작하고 `storageAvailable=false`로 둔다.
- 필요 인원 폼은 `daily_coverage` 제약(scope "ward", hard, source_text "필요 인원 설정")을 만들거나 교체한다.

### 5. `lib/api.ts` (TDD 대상 아님)
- `translate`, `solve`, `explain` fetch 래퍼. 요청에 현재 `inputVersion`을 담는다.
- 오류 응답(`ErrorBody`)을 `{ code, message, requestId }`로 throw한다. 네트워크 실패는 `NETWORK`다.
- 코드별 UI 문구 매핑을 export한다.
  - 413 → "입력이 너무 커요"
  - 422 → 메시지 그대로
  - 502 → "다르게 표현해 주세요"
  - 503 → "잠시 후 다시 시도해 주세요"
  - 500 → "문제가 생겼어요 (요청 ID: …)"

### 6. 화면
- `app/app/page.tsx`: 앱 셸. 상단 바(왼쪽 앱 이름 + 병동·월, 오른쪽 스테퍼)와 현재 단계 화면으로 구성한다. 스테퍼는 UI_GUIDE "스테퍼" 규격을 따른다.
- `components/`
  - ① 병동 화면: 대상 월 선택(기본값은 다음 달), [샘플 병동 불러오기], 붙여넣기 영역 → [변환]. 빈 입력이면 비활성이다.
  - 열 매핑 드롭다운과 "첫 행도 데이터" 토글
  - 편집 가능한 명단 표(오류 셀은 빨강)
  - 필요 인원 폼(D/E/N × 평일/주말·공휴일 min/max, 최소 > 최대면 오류)
  - 공휴일 날짜 체크(대상 월 달력에서 클릭)
  - [다음]
- `storageAvailable=false`이면 "새로고침하면 입력이 사라집니다" 배너를 띄운다. `resetNotice`이면 안내를 띄운다.
- `app/page.tsx`는 이 step에서 `/app`으로 가는 링크만 있는 임시 페이지로 둔다(랜딩은 step 14).

## Acceptance Criteria

```bash
npx vitest run
npm run build && npm run lint
uv run pytest backend/tests -q
```

vitest는 최소한 다음을 다룬다.
- `roster-import`: 탭/쉼표, 따옴표와 셀 내 줄바꿈, 헤더 동의어, 헤더 없음, 동명이인, "3년차", 나이트 전담 값 정규화, 0명/41명, 이월(명단 밖 이름, 8일 → 7일, 코드 동의어, 잘못된 코드)
- `store`: inputVersion 증가, applyCard 교체, orphanConstraintIds, 버전 불일치 초기화, localStorage 예외 시 메모리 동작

## 검증 절차

1. AC를 실행한다.
2. 수동 확인: `npm run dev` → `/app`에서 샘플 불러오기, 붙여넣기 변환, 필요 인원 수정, 새로고침 후 유지를 확인한다. 확인 후 서버를 종료한다.
3. UI_GUIDE의 "AI 슬롭 안티패턴"을 하나도 쓰지 않았는지 확인한다.
4. `phases/1-mvp/index.json`의 step 10을 업데이트한다.

## 금지사항

- UI 컴포넌트 라이브러리(shadcn, MUI 등)를 추가하지 마라. 이유: UI_GUIDE의 Tailwind 클래스 규격으로 직접 만든다.
- `lib/types.gen.ts`를 직접 수정하지 마라. 이유: `npm run gen:types`로만 생성한다.
- 다크 모드, 모바일 레이아웃을 만들지 마라. 이유: 라이트, 데스크톱 전용(UI_GUIDE).
- 기존 테스트를 깨뜨리지 마라.
