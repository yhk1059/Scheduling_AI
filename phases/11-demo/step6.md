# Step 6: landing-buttons

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — UI는 TDD 대상이 아니다
- `/docs/UI_GUIDE.md` — "랜딩 페이지"(상단 바, 히어로, CTA 띠, 푸터), "로그인 화면", 버튼 크기(랜딩·로그인 h-12)
- `/docs/PRD.md` — 화면 목록의 랜딩, J7(데모 영상)
- `/app/page.tsx` — 상단 바 `<nav>`(GitHub 링크), 히어로의 버튼 두 개와 보조 한 줄, 아래 CTA 띠의 버튼 두 개와 보조 문장
- `/components/DemoVideo.tsx` — `DemoVideoButton`(`className`과 `children`을 받는다)
- `/components/LoginScreen.tsx` — 로그인 카드와 개인정보 안내 줄
- `/components/ui.ts` — `text`, `primaryXl`, `secondaryXl`, `textSm`, `help`
- `/e2e/entry.spec.ts` S1 — 지금 랜딩 버튼 수를 검사한다(이 step에서 깨진다. step 7이 맞춘다)

## 배경

phase `11-demo`는 랜딩에 [체험하기]를 더한다. 방문자가 로그인 없이 `/demo`에서 샘플 매장(한강 다이닝)을 실제 앱 화면으로 눌러 본다(step 3~5가 만들었다). 이 step은 랜딩과 로그인 화면의 버튼 배치만 바꾼다.

지금 랜딩의 선택지는 [내 매장으로 시작하기](Google 로그인)와 [데모 영상] 둘이다. 처음 온 사람에게 로그인은 부담이 크고 영상은 수동적이다. 그 사이에 [체험하기]를 둔다. 사용자 결정: **[체험하기]가 지금 [데모 영상] 자리(히어로, 내 매장 옆)에 오고, [데모 영상]은 상단 바 오른쪽 [GitHub] 왼쪽으로 옮긴다.**

## 작업

1. **`app/page.tsx`**
   - 상단 바 `<nav>`: `[GitHub]` 왼쪽에 `<DemoVideoButton className={ui.text}>데모 영상</DemoVideoButton>`. `nav`의 `gap`은 두 항목이 붙어 보이지 않게 `gap-1`을 유지하되 각 항목이 `ui.text`(h-10, px-2)라 간격은 충분하다.
   - 히어로 버튼 줄: `[내 매장으로 시작하기]`(`/app`, `ui.primaryXl`) 옆의 `DemoVideoButton`을 `<Link href="/demo" className={ui.secondaryXl}>체험하기</Link>`로 바꾼다.
   - 히어로 보조 한 줄(`ui.help`): "체험은 샘플 매장으로 로그인 없이 눌러 볼 수 있어요. 내 매장은 Google 로그인으로 시작해요."
   - 아래 CTA 띠(`bg-[#155E75]`): 보조 문장을 "Google 로그인으로 시작해요. 체험은 로그인 없이 할 수 있어요."로, 두 번째 버튼(테두리 흰 버튼)을 `DemoVideoButton` 대신 `<Link href="/demo" …같은 className…>체험하기</Link>`로 바꾼다.
   - 푸터는 그대로(GitHub 링크 유지).
   - 랜딩은 정적이고 API를 부르지 않는다(PRD). `Link`만 더한다.

2. **`components/LoginScreen.tsx`**: 로그인 카드의 개인정보 안내 줄 아래에 `<Link href="/demo" className={ui.textSm}>샘플 매장으로 먼저 체험하기</Link>`를 둔다(`-ml-2`로 카드 왼쪽 선에 글자를 맞춘다). `supabaseConfigured`와 무관하게 보인다.

3. **`components/DemoVideo.tsx`** 머리 주석의 "랜딩과 로그인 화면의 [데모 영상]가"를 "랜딩 상단 바의 [데모 영상]이"로 고친다(코드는 그대로).

4. 수동 확인(가능하면): `/`에서 상단 바 오른쪽에 [데모 영상] [GitHub] 순서로 보이고 [데모 영상]이 대화상자를 여는지, 히어로와 CTA 띠의 [체험하기]가 `/demo`로 가는지, `/app`(로그인 화면)에 "샘플 매장으로 먼저 체험하기"가 있는지. 확인했으면 summary에 적고, 못 했으면 "수동 체크: 확인 못 함"이라고 적는다.

## Acceptance Criteria

```bash
npm run build && npm run lint && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 랜딩이 여전히 정적이고 API·store를 쓰지 않는가?
   - [데모 영상]이 상단 바에 하나만 남았고 히어로·CTA 띠에는 [체험하기]가 있는가?
   - 버튼 크기가 UI_GUIDE(랜딩·로그인 h-12)와 맞는가?
   - `lib/`·`backend/`가 바뀌지 않았는가?
3. 결과에 따라 `phases/11-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(바뀐 버튼과 문구, 수동 체크 결과, e2e S1이 어떻게 깨지는지)"`. 문서에 없는 세부 결정은 `결정: …`으로 함께 적는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `e2e/`와 `docs/`를 이 step에서 고치지 마라. 이유: step 7이 문서와 e2e를 한꺼번에 맞춘다. 깨지는 검사는 summary에 적는다.
- 히어로 시퀀스(`HeroSequence`)와 섹션 본문을 바꾸지 마라. 이유: 버튼 배치만 바꾸는 step이다.
- 새 버튼 스타일 토큰을 만들지 마라. 이유: `ui.secondaryXl`과 CTA 띠의 기존 클래스로 충분하다.
- 기존 테스트를 깨뜨리지 마라(e2e는 수동 실행이라 `npm test`에 들지 않는다).
