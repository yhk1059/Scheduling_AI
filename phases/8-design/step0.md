# Step 0: design-tokens

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/DESIGN_BRIEF.md` — 왜 디자인을 다시 하는지, 제품 이름 "말로", 결정 사항
- `/docs/UI_GUIDE.md` — 이 phase의 기준. 특히 "디자인 원칙", "워드마크", "색상", "컴포넌트 › 버튼 · 입력 필드 · 카드 · 배지", "타이포그래피"
- `/docs/ARCHITECTURE.md`
- `/components/ui.ts` — 지금의 컴포넌트 규격 클래스
- `/app/globals.css`, `/app/layout.tsx`
- `/components/Stepper.tsx` — 인라인 SVG와 Tailwind 클래스를 쓰는 방식의 예

## 배경

phase `8-design`은 승인된 디자인 시안을 코드로 옮기는 phase다. 시안은 Claude Design 캔버스에 있어 이 세션은 열 수 없다. UI_GUIDE가 시안의 값을 모두 옮겨 적었으므로 UI_GUIDE가 기준이다. 기능과 데이터 흐름은 바꾸지 않는다.

이 step은 모든 화면 step이 쓸 공용 토큰과 워드마크를 만든다. 화면은 아직 바꾸지 않는다. 이후 step이 이 step의 클래스 이름을 그대로 쓰므로, 여기서 정한 이름은 바뀌지 않는다.

## 작업

1. `components/ui.ts`에 아래 키를 **추가**한다. 기존 키는 지우거나 이름을 바꾸지 않는다(다른 화면이 아직 쓴다). 값은 UI_GUIDE "컴포넌트"와 "색상"의 클래스 문자열이다.
   - 버튼 크기: `primaryLg`(h-11 text-[15px] px-5, 화면의 Primary), `secondaryLg`, `primaryXl`·`secondaryXl`(h-12 text-[15px] px-[22px], 랜딩·로그인), `primaryBar`(h-9 px-3.5, 입력 바 안). Primary 계열은 모두 `bg-[#155E75]` 문자열을 포함해야 한다(e2e `primaryButtons`가 이 문자열로 찾는다). Primary에 `active:bg-[#0B3F4E]`를 넣는다.
   - `chip`: 예시 칩(h-7 rounded-full border border-[#C9C9C1] bg-white text-xs font-normal hover:bg-[#EFEFEB]).
   - `panel`: 강조 바탕 패널(rounded-xl bg-[#F0F6F8] border border-[#CFE4EA] px-6 py-5).
   - `bar`: 자연어 입력 바 껍데기(flex items-center h-12 bg-white border border-[#8A8A80] rounded-lg pl-4 pr-1.5 gap-2.5 + focus-within 강조 테두리), `barInput`(flex-1 border-0 outline-0 text-[15px] bg-transparent min-w-0).
   - `cardXl`: 큰 면 카드(rounded-xl bg-white border border-[#E2E2DC]).
   - `shadow`: 떠 있는 것 그림자 클래스.
   - 타이포: `pageTitle`(28px), `sectionTitle`(18px), `eyebrow`(font-mono text-xs font-semibold text-[#155E75] tracking-[0.02em]), `bigNumber`(font-mono font-semibold text-[22px]).
   - 배지 색 맵 `badgeTone`: applied·pending·draft·confirmed·operating·none·excluded·base(UI_GUIDE "배지"의 색 그대로).
2. `components/Wordmark.tsx`를 만든다. 시그니처:
   ```ts
   export function Mark({ size, tone }: { size: number; tone?: "accent" | "inverse" | "muted" }): JSX.Element  // 인라인 SVG, aria-hidden
   export default function Wordmark({ size, href, tone }: { size: "bar" | "hero" | "small"; href?: string; tone?: "accent" | "inverse" }): JSX.Element
   ```
   - 마크: viewBox 24, `rect rx=6` 바탕 + 흰 여는 따옴표 두 개(path). `tone`이 `inverse`면 바탕 흰색·따옴표 `#155E75`, `muted`면 바탕 `#66665E`.
   - 글자 "말로": `bar`는 마크 22 + `text-[18px] font-bold tracking-[-0.02em]`, `hero`는 마크 36 + `text-[32px] font-bold`, `small`은 마크 18 + `text-[13px] font-semibold`.
   - `href`가 있으면 `<a aria-label="말로 홈">`, 없으면 `<span>`.
3. `app/layout.tsx`: `metadata.title`을 "말로 · 근무표", `description`을 "말로 짜는 매장 직원 근무표"로 바꾼다. `template`을 써서 화면이 제목을 주면 "{화면} · 말로"가 되게 한다.
4. `app/globals.css`: `prefers-reduced-motion: reduce`일 때 `*`의 `transition-duration`·`animation-duration`을 0.01ms로 줄이는 규칙을 더한다.
5. `lib/wording.ts`에 `PRODUCT_NAME = "말로"`를 둔다. 화면 문구에서 제품 이름을 쓸 때 이 상수를 쓴다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `components/ui.ts`의 기존 키가 모두 남아 있는가? `grep -c "bg-\[#155E75\]" components/ui.ts`가 Primary 키 수 이상인가? `lib/types.gen.ts`를 손대지 않았는가?
3. 수동 체크(`npm run dev` 후 브라우저):
   - 브라우저 탭 제목이 "말로 · 근무표"다.
   - 기존 화면이 깨지지 않았다(이 step은 화면을 바꾸지 않는다).
4. 결과에 따라 `phases/8-design/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 추가한 ui 키 이름 전부, Wordmark 시그니처)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 화면 컴포넌트(`AppShell`, `ShopHome` 등)를 고치지 마라. 이유: 다음 step들이 화면마다 따로 한다. 범위가 겹치면 충돌한다.
- UI·아이콘·애니메이션 라이브러리를 추가하지 마라. 이유: ARCHITECTURE "쓰지 않는 것". 아이콘은 인라인 SVG다.
- 기존 `ui` 키의 값을 바꾸지 마라. 이유: 아직 옛 값으로 그려지는 화면이 있다. 바꾸는 것은 각 화면 step의 일이다.
- 기존 테스트를 깨뜨리지 마라.
