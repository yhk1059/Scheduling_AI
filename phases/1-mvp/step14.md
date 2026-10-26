# Step 14: ui-landing

## 읽어야 할 파일

- `/CLAUDE.md`, `/AGENTS.md`
- `/docs/PRD.md` (핵심 기능 7: 랜딩페이지, 사용자 페인 포인트), `/docs/ADR.md` (설계 요약에 쓸 내용)
- **`/docs/UI_GUIDE.md`** (레이아웃의 랜딩 페이지 규칙, 타이포그래피의 랜딩 h1/h2/섹션 머리말, 버튼의 랜딩 크기, AI 슬롭 안티패턴)
- `/eval/results.md` (step 9 결과, 있으면)
- step 11, 12에서 만든 카드와 그리드 컴포넌트(재사용 대상)

## 작업

`/`에 정적 랜딩페이지를 만든다(`app/page.tsx`). API를 호출하지 않는다.

1. **첫 화면**: 좌측 텍스트(랜딩 h1, 한 줄 가치 제안, 짧은 설명, [데모 시작] Primary 버튼 → `/app`), 우측 **실제 제품 화면 조각**(기존 규칙 카드 컴포넌트와 근무표 그리드 일부를 샘플 데이터로 정적 렌더). 중앙 정렬 히어로는 금지다.
2. **문제**: 수간호사 페인 포인트 4개(PRD 표 기반)
3. **동작 방식**: 말로 규칙 입력 → 솔버가 생성 → 막히면 이유와 검증된 해결책. 각 단계 한두 문장
4. **데모**: 데모 GIF 자리표시. `public/demo.gif`가 있으면 그것을 보여주고, 없으면 "데모 영상 준비 중" 상자를 보여준다(`public/` 파일 존재 여부를 빌드 시점에 확인하거나, 고정 자리표시로 둔다).
5. **설계 요약**: LLM은 번역과 설명 / CP-SAT는 계산 / LLM 출력 검증 장치(스키마 검증, 사람의 적용, 재풀이 검증) / eval 결과
   - eval 수치는 `eval/results.md`의 최종 값을 **그대로** 옮긴다. 없으면 수치를 넣지 않는다.
6. **푸터**: GitHub 링크. URL은 `app/page.tsx` 상단의 상수 `REPO_URL` 한 곳에만 두고, 값은 `git remote get-url origin`에서 `.git`을 뺀 주소로 한다(저장소 이전 시 한 줄만 바꾸면 되도록).
- 섹션은 `py-[72px] border-t`이고, 섹션 머리말은 mono 청록이다(UI_GUIDE).

## Acceptance Criteria

```bash
npm run build && npm run lint
npx vitest run
uv run pytest backend/tests -q
```

## 검증 절차

1. AC를 실행한다.
2. 수동 확인: `npm run dev` → `/` 렌더링 확인 → [데모 시작]으로 `/app`에 이동하는지 확인한다. 확인 후 서버를 종료한다.
3. UI_GUIDE 안티패턴(그라데이션 텍스트, blur, 글로우, 보라색, gradient orb, "Powered by AI" 배지, 장식 이미지, 근거 없는 수치나 후기)이 하나도 없는지 확인한다.
4. `phases/1-mvp/index.json`의 step 14를 업데이트한다.

## 금지사항

- 근거 없는 수치("시간 90% 절약" 등)나 가짜 후기를 넣지 마라. 이유: UI_GUIDE 랜딩 규칙. 수치는 eval 결과처럼 실제 측정값만 쓴다.
- 랜딩에서 API를 호출하지 마라. 이유: 정적 페이지다(PRD).
- 장식용 일러스트나 스톡 이미지를 넣지 마라.
- 기존 테스트를 깨뜨리지 마라.
