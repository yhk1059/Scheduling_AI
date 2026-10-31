# Step 2: landing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — "화면별 방향 › 랜딩"
- `/docs/UI_GUIDE.md` — "디자인 원칙", "움직임", "레이아웃 › 랜딩 페이지", "컴포넌트 › 규칙·요청 카드 · 입력 필드 › 자연어 입력 바", "타이포그래피", "문구"
- `/docs/PRD.md` — "핵심 기능 › 9. 랜딩페이지"
- `/components/ui.ts`, `/components/Wordmark.tsx`
- `/app/page.tsx`, `/components/LandingPreview.tsx` — 지금의 랜딩과 화면 조각
- `/components/ScheduleStep.tsx` — `ScheduleGrid`, `codeClass`, `CELL`(그대로 재사용한다)
- `/lib/samples/shop-12.json`, `/lib/samples/demo-schedule.json` — 샘플 데이터
- `/lib/wording.ts` — `describeRule`, `presetName`, `hardnessLabel`

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮긴다. UI_GUIDE가 기준이고 기능은 바꾸지 않는다. 랜딩은 정적 페이지이고 API를 부르지 않는다. 이 step은 랜딩 전체를 UI_GUIDE "레이아웃 › 랜딩 페이지" 구성으로 다시 만들고, 히어로의 정지 화면 조각을 한 번 재생되는 시퀀스로 바꾼다.

규칙 카드는 step 5에서 "답장 형태"로 바뀐다. 이 step의 히어로와 문제 섹션에 들어가는 카드는 `LandingPreview.tsx`의 `PreviewCard`처럼 **직접 그린 정적 카드**이므로 UI_GUIDE "규칙·요청 카드 — 답장처럼"의 모양을 여기서 먼저 구현해도 된다(`ConstraintCard`는 건드리지 않는다).

## 작업

1. `components/LandingPreview.tsx`를 `components/HeroSequence.tsx`로 바꾼다(옛 파일 삭제). 클라이언트 컴포넌트.
   ```ts
   export default function HeroSequence(): JSX.Element
   ```
   - 구성: `ui.panel`(`p-[22px] min-h-[420px] rounded-xl`) 안에 ① 입력 바(`ui.bar`, 마크 18, 버튼 "규칙 만들기"는 `aria-hidden` 장식) ② 규칙 카드(금지 순서 · "마감 다음 날 오픈은 안 되게" → "이렇게 읽었어요" · "모든 사람 · 매일 · 마감 다음 날 오픈 금지" · `적용됨`) ③ "11/2~11/8 근무표" 카드(`ScheduleGrid`를 샘플 5명 × 7일로 렌더, 마감 합계 행, 끝에 `규칙을 모두 지켰어요` 배지) ④ 아래 줄 "실제 화면이에요. 샘플 매장 12명 중 5명, 첫 주만 보여요." + [다시 보기] Text.
   - 시퀀스는 CSS만 쓴다(`globals.css`에 `@keyframes` 추가, 클래스로 지연): 타이핑(`width` steps, 0.4~1.6s, 커서 깜빡임) → 카드 올라옴(2.0s, 8px translate + opacity) → 셀이 행마다 왼쪽부터 `scale(.6)→1`(2.6s부터 행 0.42s · 칸 0.06s 간격) → 배지(5.3s). 셀 지연은 `style={{ animationDelay }}`로 준다. `ScheduleGrid`가 셀 스타일을 받지 못하면 그리드를 감싸는 요소에서 `:nth-child` 대신 **셀마다 래퍼를 두지 말고** `ScheduleGrid`에 선택적 `cellStyle?: (employeeId, day) => CSSProperties` prop을 더한다(기본값 없음, 다른 호출처 영향 없음).
   - [다시 보기]는 상태 키를 올려 패널을 다시 마운트해 애니메이션을 처음부터 돌린다. `prefers-reduced-motion`이면 끝 상태를 바로 보인다(`globals.css` 규칙 + 타이핑 `width:100%`).
   - 샘플 데이터: `shop-12.json`의 e01·e05·e06·e07·e08과 `demo-schedule.json` 첫 7일. 조작 불가(`inert`).
2. `app/page.tsx`를 UI_GUIDE "레이아웃 › 랜딩 페이지" 순서로 다시 쓴다: 상단 바(워드마크 19px, Text 링크 [문제] [동작 방식] [만든 방식] [GitHub], [내 매장으로 시작하기] `ui.primary`) → 히어로(5fr/7fr, 아이브로우 "말로 · 매장 직원 근무표", 제목 "말로 설명하면,<br>근무표가 나옵니다" 52px, 설명, [샘플로 체험하기] `ui.primaryXl` → `/demo`, [내 매장으로 시작하기] `ui.secondaryXl` → `/app`, 보조 한 줄, 오른쪽 `<HeroSequence />`) → 01 문제(전/후 3쌍 + 3열) → 02 동작 방식(세로 4줄, mono 48 번호, 화면 조각) → 03 만든 방식(3열 카드 + 정확도 줄 + GitHub 링크) → CTA 띠(`bg-[#155E75]`) → 푸터. 섹션 문구는 UI_GUIDE·PRD에 적힌 것을 쓰고, 없는 문구는 해요체로 짧게 쓴다. 섹션 `id`는 problem·how·built.
   - 전/후 쌍의 "지금" 쪽은 `bg-[#EFEFEB] rounded-lg` 안 말풍선(글자만, 메신저 로고·색 없음). "말로에서는" 쪽은 링크 카드 · 규칙 카드 · 해 없음 패널 + 제안 카드(정적).
   - 02의 화면 조각: 가능 시간 캘린더 미니(칠한 칸 `bg-[#155E75]`), 입력 바 + 예시 칩, 요약 지표 카드, 운영 중 변경(바뀐 칸 주황 테두리). 모두 정적.
   - 03 정확도 줄: `번역 정확도 [__%] · 매니저 말투 문장 [__개]` 자리표시. 숫자를 지어내지 않는다.
   - 데모 GIF 섹션, `existsSync`·`node:fs` import, `next/image` 사용을 모두 지운다.
3. `REPO_URL` 상수는 그대로 한 곳에 둔다. 푸터는 회색 마크(`<Mark tone="muted" />`) + "말로 · 포트폴리오 프로토타입" + 링크 2개.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
grep -L "node:fs" app/page.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `app/page.tsx`가 API·store·Supabase를 부르지 않는가? UI_GUIDE "AI 슬롭 안티패턴"에 걸리는 클래스(`backdrop-blur`, `bg-gradient`, `blur-3xl`, 보라색)가 없는가(`grep -nE "backdrop-blur|bg-gradient|blur-3xl|violet|indigo|purple" app/page.tsx components/HeroSequence.tsx`가 비어야 한다)?
3. 수동 저니 체크리스트(`npm run dev`, 1440px):
   - `/` 첫 화면에서 타이핑 → 카드 → 셀 채우기 → 배지가 6초 안에 끝나고 멈춘다. [다시 보기]로 다시 돌아간다.
   - 브라우저 reduced-motion을 켜면(DevTools Rendering) 끝 상태가 바로 보인다.
   - 상단 바 링크가 섹션으로 스크롤되고, 두 CTA가 `/demo`·`/app`으로 간다.
   - 히어로 근무표의 열 이름·코드 색이 앱과 같다.
   - 1280px에서 가로 스크롤이 없다.
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, ScheduleGrid에 더한 prop, 애니메이션 구현 방식)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 애니메이션·아이콘 라이브러리를 추가하지 마라. 이유: ARCHITECTURE "쓰지 않는 것". CSS `@keyframes`와 인라인 SVG로 한다.
- 히어로를 이미지·영상·GIF로 대체하지 마라. 이유: UI_GUIDE "움직임". 실제 컴포넌트가 제품의 증거다.
- 근거 없는 수치·후기를 넣지 마라. 이유: UI_GUIDE "레이아웃 › 랜딩". 정확도는 자리표시다.
- `ConstraintCard.tsx`·`ScheduleStep.tsx`의 기존 동작을 바꾸지 마라(선택적 prop 추가만). 이유: step 5·6의 범위다.
- 기존 테스트를 깨뜨리지 마라.
