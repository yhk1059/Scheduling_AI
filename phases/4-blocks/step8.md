# Step 8: ui-settings-roster

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- **`/docs/UI_GUIDE.md`** ("처음 설정", "병동 설정", "근무 코드", "문구", 색·컴포넌트 규칙)
- `/docs/PRD.md` (데이터 층, J1)
- `/notes/structure-blocks-design-2026-10-29.md` (§8 화면 변경)
- `/lib/store.ts`, `/lib/wording.ts` (step 7)
- `/components/WardSettings.tsx`, `/components/SetupFlow.tsx`, `/components/CoverageForm.tsx`, 명단 표를 그리는 컴포넌트, `/components/ui.ts`

## 배경

데이터 층은 step 7에서 새 형식이 됐다. 이 step은 **병동 쪽 화면**을 연다: 근무 형태(근무 코드) 편집, 명단 태그, 근무 코드에 따라 늘어나는 필요 인원 표, 처음 설정 ②의 근무 형태 요약, 변환하지 못한 규칙 안내.

## 작업

### 1. 근무 형태 (`components/ShiftTable.tsx` 새로, UI_GUIDE "병동 설정")
- 표: 코드 · 이름 · 시작 시각 · 시간 · 세는 근무조. 맨 아래 입력 줄로 추가(명단 표와 같은 방식: Enter·[추가], 칸별 오류).
- 세는 근무조를 둘 고르면 복합 코드(더블). `O`는 읽기 전용. 쓰인 적 있는 코드는 [끄기]/[다시 켜기], 쓰인 적 없으면 [삭제].
- 표 위 한 줄 "말로 '미드 근무 11시~19시 추가'라고 적어도 돼요".
- 오류: 코드 형식, 중복, 시간 범위, 코드 수 상한(`constants`와 같은 숫자, step 3).

### 2. 병동 설정 탭 (`WardSettings.tsx`)
- 탭 순서 [명단·필요 인원] [근무 형태] [병동 규칙].
- 병동 규칙 탭 위에 `ward.unconverted`가 있으면 주의 배너 "옛 규칙 n개를 새 형식으로 옮기지 못했어요. 다시 입력해 주세요" + 원문 목록(버튼 없음, 다시 입력하면 목록에서 지우는 [지우기] Text).

### 3. 명단 태그
- 명단 표의 나이트 전담 칸을 **태그 칸**으로 바꾼다(UI_GUIDE: 칩 입력, Enter·쉼표, 자동 완성, `나이트전담` 추천 칩, 5개 상한, "태그에는 이름을 쓰지 마세요").
- 입력 줄에도 태그 칸.

### 4. 필요 인원 표 (`CoverageForm.tsx`)
- 행 = 활성 기본 코드(복합 제외). 열 = 평일 / 주말·공휴일. "하루" 합계 줄과 오류 문구는 지금 규칙 그대로(복합 코드 근무자는 근무 인원으로 한 번만 센다).

### 5. 처음 설정 ② (`SetupFlow.tsx`)
- 필요 인원 표 위에 근무 형태 요약 한 줄 + [바꾸기](`aria-expanded`), 펼치면 `ShiftTable`.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
! grep -rnE '나이트 전담</|night_only' components app
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 동작 확인: `npm run dev` → 빈 병동 → ① 명단에 태그 붙여 3명 → ② 근무 형태 [바꾸기]로 M 추가 → 필요 인원에 M 행이 생기는지 → 병동 설정 [근무 형태]에서 M 끄기 → 필요 인원 행이 사라지는지를 Playwright 스크립트(임시, 커밋하지 않음)나 브라우저로 확인하고 서버를 끈다. 다른 프로세스가 3000/8000 포트를 쓰면 건너뛰고 summary에 적는다(남의 프로세스를 끄지 않는다).
3. UI_GUIDE 체크: 영역마다 Primary 하나, 색은 근무 코드와 상태에만, 문구 표의 말(근무 형태, 태그, 더블)을 썼는가?
4. 결과에 따라 `phases/4-blocks/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. UI_GUIDE에 없는 세부는 멈추지 말고 기존 표(명단 표)와 같은 패턴으로 정한 뒤 summary에 `결정: …`으로 적는다.

## 금지사항

- 규칙 카드, 근무표 작성·확정 화면, 홈을 바꾸지 마라. 이유: step 9의 범위다.
- UI 컴포넌트 라이브러리나 새 npm 의존성을 추가하지 마라.
- 기존 테스트를 깨뜨리지 마라.
