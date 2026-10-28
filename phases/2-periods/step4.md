# Step 4: ui-ward

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` ("화면", J0, J1, J5)
- **`/docs/UI_GUIDE.md`** 전체 (특히 "화면 구조", "병동 홈", "병동 설정", "반복 사용 컴포넌트"의 비활성 간호사·배너·대화상자, "상호작용 상태", "문구", "접근성", "레이아웃")
- `/lib/store.ts` (step 3의 `ward + periods[]`, `View`, 액션), `/lib/period.ts`
- `/components/AppShell.tsx`, `/components/EntryStep.tsx`, `/components/WardStep.tsx`, `/components/RosterEditor.tsx`, `/components/CoverageForm.tsx`, `/components/RulesStep.tsx`, `/components/ConstraintCard.tsx`, `/components/ui.ts`, `/app/app/page.tsx`

## 배경

앱 화면을 UI_GUIDE "화면 구조"대로 바꾼다: 시작 화면 / 병동 홈 / 병동 설정 / 기간 작업.
이 step은 **앱 셸, 시작 화면, 병동 홈의 뼈대, 병동 설정**을 만든다. 기간 작업 화면(스테퍼 ①②③)은 step 5, 홈의 운영 중·다음 기간 카드 완성은 step 9, 로그인과 계정은 step 13에서 한다.
UI 컴포넌트는 TDD 대상이 아니다. build, lint, 수동 확인으로 검증한다.

## 작업

### 1. 앱 셸 (`components/AppShell.tsx`)
- 상단 바: 왼쪽 "간호사 근무표" + 병동 이름 · 기간 단위(`unitLabel`), 오른쪽은 저장 상태 자리(지금은 게스트 문구 "이 브라우저에만 저장"만). 스테퍼는 상단 바에 두지 않는다.
- 탭 줄: [홈] [병동 설정] Text 탭, 현재 탭은 `font-semibold text-[#1B1B18]` + `aria-current="page"`. 시작 화면에서는 숨긴다.
- `view.screen`에 따라 병동 홈 / 병동 설정 / 기간 작업(지금은 기존 기간 화면 컴포넌트를 연결해 두고 step 5에서 교체)을 그린다.
- 기존 배너(저장소 사용 불가, 초기화 알림)는 UI_GUIDE의 주의 배너 하나로 통일한다.

### 2. 시작 화면 (`components/StartScreen.tsx`, 기존 `EntryStep.tsx` 대체)
- `/app`에 들어올 때마다 보인다(로그인 기능은 step 13에서 붙인다).
- 버튼: [샘플로 체험하기], [내 병동으로 시작하기]. 브라우저에 입력이 있으면(`hasInput`) [이어서 하기]를 더한다. [Google로 로그인] 자리는 step 13에서 채운다.
- 입력이 있는데 샘플이나 새로 시작을 고르면 공용 대화상자로 "지금 입력을 지우고 새로 시작할까요?"를 확인한다.
- 샘플 → 병동 홈, 새로 시작 → 병동 설정 [명단·필요 인원] 탭.

### 3. 공용 대화상자 (`components/Dialog.tsx`)
UI_GUIDE "대화상자" 규칙을 그대로 따른다: `fixed inset-0 bg-[#1B1B18]/40`, 카드 스타일 `max-w-[440px]`, blur·그림자 없음, `role="dialog"` `aria-modal="true"`, Esc로 닫기, 열릴 때 첫 버튼 포커스, 닫으면 연 버튼으로 포커스 복귀, 버튼 최대 2개(Primary 하나). step 13에서 로그인 요구·샘플 저장·데이터 삭제 대화상자에 재사용한다.

### 4. 병동 홈 뼈대 (`components/WardHome.tsx`)
- 페이지 제목은 병동 이름.
- **처음 쓰는 경우**(명단이나 필요 인원이 비어 있음): 병동 설정으로 안내하는 한 줄 + [병동 설정] Primary.
- 병동이 준비되면: [첫 기간 만들기] 또는 [다음 기간 만들기] Primary(`createPeriod(today)`), 최근 기간 표(기간 `formatRange` mono, 상태 배지 초안/확정, 확정 시각; 행 클릭 → 그 기간). 비면 "아직 확정한 기간이 없어요" + [첫 기간 만들기].
- 병동 요약 한 줄: "활성 15명 (비활성 1명) · 병동 규칙 6개" + [병동 설정] Text.
- 운영 중 기간 카드와 다음 기간 카드의 상태별 버튼은 step 9에서 완성한다. 지금은 위 구성으로 충분하다.

### 5. 병동 설정 (`components/WardSettings.tsx`)
- 탭 2개: [명단·필요 인원] [병동 규칙].
- [명단·필요 인원]:
  - 맨 위 "기본" 영역: 병동 이름 입력, 기간 단위 select(`PERIOD_UNITS`). 단위를 바꾸면 주의 배너 "다음에 만드는 기간부터 적용돼요. 최소 오프 일수 같은 규칙 값을 다시 확인하세요"를 보여 준다.
  - 명단 표(기존 `RosterEditor` 재사용·수정): 이름 입력란에 "이니셜을 써도 됩니다" 안내. 행 동작은 [비활성으로] / [다시 활성으로]. 비활성 간호사는 기본으로 접고 "비활성 N명 보기" Text 버튼으로 펼친다. 비활성 행은 이름 `text-[#66665E]` + `비활성` 배지. 아직 어떤 기간에도 쓰이지 않은 간호사만 [삭제] Danger를 보인다.
  - 명단 붙여넣기·CSV 업로드(기존 기능)는 `replaceRoster`로 반영한다.
  - 필요 인원 폼(기존 `CoverageForm`): 필수. 비어 있으면 "필요 인원을 입력하면 기간을 만들 수 있어요"를 표시한다.
- [병동 규칙]: 기존 `RulesStep`을 scope `"ward"`로 재사용(자연어 입력 바 + 규칙 카드). 이 탭에서는 "이번 기간 꺼짐"을 보이지 않는다.
- 병동 설정 하단에 상태에 맞는 다음 동작 하나: 기간이 없으면 [첫 기간 만들기] Primary.

### 6. 정리
- 더 이상 쓰지 않는 컴포넌트(`EntryStep`, 옛 `WardStep`의 기간 선택 부분 등)는 지운다. 기존 1~4단계 `Stepper`는 step 5에서 기간 작업 스테퍼로 바꾸므로 남겨 둔다.

## Acceptance Criteria

```bash
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 수동 확인: `npm run dev` → `/app` → 시작 화면 → [샘플로 체험하기] → 병동 홈 → [병동 설정] 탭(기간 단위 변경 배너, 간호사 비활성/다시 활성, 비활성 접기) → [병동 규칙] 탭 → [홈] → [다음 기간 만들기]로 기간 화면 진입. 새로고침 후 [이어서 하기]로 복귀. 확인 후 서버를 종료한다.
3. UI_GUIDE 체크: 한 영역에 Primary 하나, 탭 `aria-current`, 대화상자 포커스·Esc, 금지 패턴(blur, 그림자, 그라데이션, 보라색) 없음, 비활성 버튼 옆에 이유 한 줄.
4. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- UI 컴포넌트 라이브러리나 라우팅 라이브러리를 추가하지 마라. 이유: 기술 스택 금지 목록. 화면 전환은 store의 `view`로 한다.
- `/app` 아래에 새 Next 라우트(`/app/settings` 등)를 만들지 마라. 이유: 상태가 클라이언트 store에만 있고, `/app`은 SSR 없이 한 페이지로 그린다(ARCHITECTURE 디렉토리 구조).
- 로그인 버튼, 계정 메뉴, Supabase 코드를 넣지 마라. 이유: step 13의 범위다.
- 간호사 [삭제]를 기본 동작으로 두지 마라. 이유: 퇴사자도 이력과 통계에 남아야 한다(PRD J5).
- 기존 테스트를 깨뜨리지 마라.
