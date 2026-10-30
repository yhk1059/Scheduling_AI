# Step 2: rename-backend

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/notes/shop-pivot-design-2026-10-30.md` (전환 결정과 용어)
- `/docs/ADR.md`의 ADR-020
- `/backend/domain/models.py`
- `/backend/domain/constants.py`
- `/backend/routes.py`
- `/backend/llm/pseudonym.py`
- `/docs/ARCHITECTURE.md`

## 배경

프로젝트를 간호사 근무표에서 매장 직원 근무표로 전환하는 중이다. 문서(`docs/`)는 이미 전환 후 기준이고, 코드는 step마다 그 기준으로 옮겨진다. 실제 사용자, 저장 데이터, 배포가 없으므로 하위 호환 코드를 남기지 않는다.

이 step은 백엔드만 다룬다. 프론트(`lib/`, `components/`, `app/`, `e2e/`)는 `6-shop-pivot`의 뒤 step에서 옮기므로 그 사이 `npm run build`와 vitest가 깨지는 것은 정상이다. 백엔드 pytest만 통과시켜라. 백엔드 이름을 매장 용어로 바꾼다. 동작은 바꾸지 않는다.

## 작업

- 이름: `Nurse`→`Employee`, `nurses`→`employees`, `nurse_id(s)`→`employee_id(s)`, `NurseStats`→`EmployeeStats`, `WardConfig`→`ShopConfig`, `ward`→`shop`(translate `scope` 값 `"ward"`→`"shop"`, 규칙 `scope` 포함), `MAX_NURSES`→`MAX_EMPLOYEES`, `MAX_TAGS_PER_NURSE`→`MAX_TAGS_PER_EMPLOYEE`, 함수·변수·테스트 이름도 같다.
- 사용자에게 가는 오류 문구와 주석의 간호사→직원, 병동→매장, 수간호사→매니저.
- 가명 `N01`→`E01`.
- 파일: `lib/samples/ward-15.json`→`lib/samples/shop-12.json`(내용은 step 3), `backend/gen_demo.py` 등 경로 참조. 데이터 파일(`eval/dataset.jsonl`, 샘플, golden)의 키도 함께 바꾼다.
- `npm run gen:types`로 타입을 다시 만든다.

## Acceptance Criteria

```bash
uv run pytest backend/tests scripts/test_hooks.py
git grep -nE '[Nn]urse|NURSE|\bward|Ward|WARD|_ward|간호|병동' -- backend eval/run.py && exit 1 || true
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크: `backend/solver/`와 `backend/llm/`이 서로 import하지 않는가? `lib/types.gen.ts`를 손으로 고치지 않았는가? `backend/`가 DB에 접근하지 않는가? 상수는 `backend/domain/constants.py`에 있는가?
3. 결과에 따라 `phases/6-shop-pivot/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(파일, 핵심 결정)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - `blocked`는 쓰지 않는다. 사람이 없는 환경에서 실행된다. 문서에 없는 세부 결정은 summary에 `결정: …`으로 적고 진행한다.

## 금지사항

- 프롬프트의 예시 내용을 다시 쓰지 마라. 이름만 바꾼다. 이유: step 4의 일이다.
- `backend/`에 `store`라는 이름으로 매장을 부르지 마라. 이유: ADR-020.
- 이 step의 범위 밖 파일을 고치거나 다음 step의 일을 미리 하지 마라. 이유: step마다 독립 세션이 실행되어 범위가 겹치면 충돌한다.
