# 프로젝트: 매장 직원 근무표 (LLM + CP-SAT)

## 기술 스택
- Next.js 16 (App Router), TypeScript strict mode, Tailwind CSS 4
- FastAPI on Vercel Python 함수 (Python 3.12, uv), Pydantic v2
- OR-Tools CP-SAT (솔버), Anthropic Claude API (tool use)
- Supabase (Postgres + Auth, Google OAuth) — 로그인 사용자의 매장 저장 (ADR-014)

## 아키텍처 규칙
- CRITICAL: `backend/solver/`와 `backend/llm/`은 서로 import하지 말 것. 둘의 조합은 `backend/routes.py`에서만 한다.
- CRITICAL: LLM 출력은 Pydantic 검증을 통과해야만 쓰고, 그 뒤 사람이 확인(제안 카드)하거나 서버가 재풀이로 검증한 것만 결과에 반영할 것.
- CRITICAL: Anthropic API 키와 호출은 서버(`backend/`)에서만 할 것. 백엔드는 무상태로 유지하고, 클라이언트가 필요한 상태를 매 요청에 담아 보낸다.
- CRITICAL: DB 접근은 클라이언트에서 supabase-js + RLS로만 한다. 로그인 없는 직원 링크는 토큰을 확인하는 DB 함수만 호출한다. `backend/`는 DB에 접근하지 않는다.
- `api/index.py`는 진입점만 둔다. 백엔드 코드는 `backend/` 패키지에 둔다.
- 상수(상한, 시간 예산, 가중치)는 `backend/domain/constants.py`에 모은다.

## 개발 프로세스
- CRITICAL: 백엔드(`backend/`) 전체와 `lib/`의 순수 함수는 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- UI 컴포넌트(`app/`, `components/`)와 `lib/api.ts`, `lib/supabase.ts`는 TDD 대상이 아니다. build, lint, 수동 저니로 검증한다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버 (Next :3000 + FastAPI :8000)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # pytest (backend/tests, scripts/test_hooks.py)
uv pip install -r requirements-dev.txt   # Python 의존성 설치 (.venv, Python 3.12)
