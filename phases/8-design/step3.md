# Step 3: sample-demo

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "화면별 방향 › 샘플 데모"
- `/docs/UI_GUIDE.md` — "디자인 원칙 1", "레이아웃 › 샘플 데모 상단 바 · 샘플 데모 본문", "컴포넌트 › 요약 지표 · 규칙·요청 카드", "타이포그래피"
- `/docs/PRD.md` — "J7. 샘플 데모"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/components/SampleDemo.tsx`, `/app/demo/page.tsx`
- `/components/HeroSequence.tsx` — step 2가 만든 정적 규칙 카드 그리는 방식(같은 모양을 쓴다)
- `/components/ScheduleStep.tsx` — `ScheduleGrid`, `StatsTable`, `SummaryCard`
- `/lib/samples/shop-12.json`, `/lib/samples/demo-schedule.json`

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. 샘플 데모는 모든 방문자에게 같은 보기 전용 화면이고 API·저장소를 쓰지 않는다. 지금은 규칙 카드 7장이 먼저 나오고 근무표가 아래에 있다. 원칙 1 "근무표가 주인공이다"에 따라 순서를 뒤집고 샘플 데모용 상단 바를 둔다.

## 작업

1. `app/demo/page.tsx`: `metadata.title`을 "샘플 데모"로(layout의 template으로 "샘플 데모 · 말로"가 된다).
2. `SampleDemo.tsx`를 UI_GUIDE "레이아웃 › 샘플 데모 본문" 순서로 다시 쓴다.
   - 상단 바: 흰 띠 60px, `<Wordmark size="bar" href="/" />` + 구분선 + `샘플 데모` 배지(`bg-[#EFEFEB] text-[#3D3D38]`) + 오른쪽 [내 매장으로 시작하기] `ui.primary`(`/app`). 탭 줄 없음.
   - 제목 줄: "샘플 매장"(`ui.pageTitle`) + `확정` 배지 / "직원 12명 · 매장 조건 7개 · 4주 단위 · 2026-11-02 ~ 11-29(mono)" / 오른쪽 "모두에게 같은 화면이에요. 바꾸거나 저장할 수 없어요."
   - 요약 지표: `SummaryCard`를 재사용할 수 있으면 쓰고, 칸 구성이 맞지 않으면 같은 규격으로 직접 그린다. 칸은 "결과 `규칙을 모두 지켰어요`", "반드시 규칙 5/5", "못 지킨 규칙 0", "마감 횟수 차이 · 가장 많음 n · 가장 적음 n"(샘플 데이터에서 계산).
   - 근무표 카드: 제목 "11/2~11/29 근무표" + 오른쪽 범례(A 오픈 09~15 · M 미들 12~18 · C 마감 17~23 · O 휴무, 작은 셀) → `ScheduleGrid` 28일 전체(`overflow-x-auto`) + 날짜별 A/M/C 합계 행 + 개인별 코드 합계 열. 조작 불가(`inert`).
   - 매장 조건: "매장 조건 7개"(`ui.sectionTitle`) + 보조 한 줄 → 3열 그리드에 정적 규칙 카드 7장(답장 형태, `적용됨`) + 마지막 칸에 필요 인원 표(`기본` 배지, 근무조 × 평일/주말·공휴일).
   - 하단: 구분선 위에 "내 매장 명단으로 같은 흐름을 바로 시작할 수 있어요." + [내 매장으로 시작하기] `ui.primary`.
3. 규칙 카드 문장은 `describeRule`로 만든다(직접 쓰지 않는다). 샘플 데이터의 코드·이름·문장을 바꾸지 않는다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `SampleDemo`가 store·API·Supabase를 부르지 않는가? 샘플 JSON을 고치지 않았는가?
3. 수동 저니 체크리스트(`npm run dev`, 1440px):
   - `/demo` 첫 화면에서 제목 아래 바로 요약 지표와 근무표가 보인다. 규칙 카드는 스크롤 아래다.
   - 근무표 28일이 가로 스크롤 상자 안에 들어가고 셀은 30px이다. 주말 열 바탕과 토·일 헤더 색이 UI_GUIDE와 같다.
   - 상단 바 워드마크가 `/`로, 두 CTA가 `/app`으로 간다.
   - 어떤 칸·카드도 눌리지 않는다.
   - 1280px에서 가로 페이지 스크롤이 없다(표 상자 안 스크롤만).
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 샘플 데모에 조작·저장·API 호출을 넣지 마라. 이유: PRD J7.
- `ConstraintCard.tsx`를 고치지 마라. 이유: step 5의 범위. 데모 카드는 정적으로 그린다.
- 샘플 JSON의 데이터를 바꾸지 마라. 이유: e2e와 랜딩이 같은 데이터를 쓴다.
- 기존 테스트를 깨뜨리지 마라.
