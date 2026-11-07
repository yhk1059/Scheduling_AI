# Step 15: readme

## 읽어야 할 파일

- `/CLAUDE.md`, `/docs/PRD.md`, `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/eval/results.md`
- `/package.json`, `/requirements.txt`, `/requirements-dev.txt`
- `/phases/1-mvp/index.json` (각 step summary)

## 작업

저장소 루트에 포트폴리오용 `README.md`를 작성한다(한국어).

1. **한 줄 소개**와 데모 링크 자리표시(`<!-- DEMO_URL -->`)
2. **문제와 사용자**: 수간호사 페르소나, 페인 포인트 4개
3. **데모**: GIF 자리표시(`docs/demo.gif` 또는 `public/demo.gif` 경로를 주석으로 안내), 데모 저니 8단계 요약
4. **아키텍처**
   - ARCHITECTURE.md의 구성을 간단한 다이어그램(코드 블록이나 mermaid)으로 표현
   - "LLM은 번역과 설명, 솔버는 계산"이라는 역할 분리를 설명
5. **설계 결정**: ADR 핵심 5~6개를 한 줄씩. 결정과 이유를 쓰고, 각각 ADR.md로 링크한다.
6. **LLM 출력을 믿지 않는 방법**: 스키마 검증과 재시도, 참조 무결성, 사람의 적용, 재풀이 검증, 결정적 대체 경로, 가명 처리
7. **Eval**: `eval/results.md`의 최종 지표 표를 **그대로** 옮기고 링크한다. 데이터셋 구성을 한 줄로 쓴다.
8. **AI로 만든 방법**: harness(`scripts/execute.py`)로 step 16개를 자동 실행한 과정. phase/step 구조, TDD 가드 훅, step별 summary를 짧게 소개한다.
9. **로컬 실행**: uv(Python 3.12)와 npm 설치, `.env.local`에 `ANTHROPIC_API_KEY`, `npm run dev`, `npm run test`, `uv run python eval/run.py`
10. **범위 밖**: PRD의 MVP 제외 사항 요약

## Acceptance Criteria

```bash
test -s README.md
npm run build && npm run lint
npm run test
```

## 검증 절차

1. AC를 실행한다.
2. README의 명령어가 실제 `package.json` 스크립트와 일치하는지, 수치가 `eval/results.md`와 일치하는지 대조한다.
3. `phases/1-mvp/index.json`의 step 15를 업데이트한다.

## 금지사항

- 측정하지 않은 수치나 기능을 쓰지 마라. 이유: 포트폴리오의 신뢰성.
- API 키, `.env.local` 내용, 개인 이메일을 넣지 마라.
- 배포를 실행하지 마라(`vercel deploy` 금지). 이유: 프로덕션 배포는 사용자가 확인한 뒤 수동으로 진행한다.
- 코드를 수정하지 마라(README와 오탈자 수준 docs만).
