# Step 6: solver-history-load

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (페인 포인트 표의 누적 부담, J3, 핵심 기능 5·6)
- `/docs/ADR.md` (ADR-003, ADR-010의 나이트 전담, ADR-015의 누적 부담)
- `/docs/ARCHITECTURE.md` (API 계약의 `history_load`)
- `/backend/domain/models.py`, `/backend/domain/constants.py`
- `/backend/solver/soft.py` (`night_fairness`, `weekend_fairness`, `_spread`), `/backend/solver/model.py`, `/backend/solver/stats.py`
- `/backend/routes.py`, `/backend/tests/test_solver_soft_stats.py`, `/backend/tests/test_domain.py`, `/backend/tests/test_routes.py`

## 배경

PRD: "지난번에 나이트를 많이 한 사람을 이번에 배려하기 어렵다 → 최근 4주 누적 부담을 공정성에 반영".
ADR-015: 최근 4주의 나이트·주말 근무 요약을 **클라이언트가 계산해 요청에 담아 보내고**, 백엔드는 무상태로 공정성 목적함수에 반영한다. 이 step은 백엔드 쪽(모델, 솔버)만 한다. 클라이언트 계산은 step 7에서 한다.

## 작업

**테스트를 먼저 작성한다**(솔버는 실제로 돌린다).

### 1. `backend/domain/constants.py`
- `HISTORY_DAYS = 28` (누적 부담 창, 일)

### 2. `backend/domain/models.py`
```python
class HistoryLoad(_Strict):
    nurse_id: str
    nights: int = Field(ge=0, le=HISTORY_DAYS)    # 최근 28일 N 수
    weekends: int = Field(ge=0, le=HISTORY_DAYS)  # 최근 28일 주말·공휴일 근무(D/E/N) 수

class ScheduleRequest(...):
    ...
    history_load: list[HistoryLoad] = []
```
- 참조 무결성: 명단에 없는 `nurse_id`, 같은 `nurse_id` 중복은 오류로 처리한다(기존 `_referential_integrity`에 추가).
- `npm run gen:types`로 TS 타입을 재생성한다.

### 3. 공정성 반영 (`backend/solver/soft.py`)
- `night_fairness`: 나이트 전담을 뺀 간호사의 **(history nights + 이번 기간 N 수)** 합계의 최대−최소 편차에 페널티. history가 없는 간호사는 0으로 본다.
- `weekend_fairness`: **(history weekends + 이번 기간 주말·공휴일 근무 수)** 합계로 같은 방식.
- history_load가 비어 있으면 지금과 결과가 같아야 한다(회귀 방지).
- soft 위반 나열(`stats.py`)의 공정성 편차도 같은 합계 기준으로 계산하고, `detail` 문구에 누적 포함임을 드러낸다(예: "최근 4주 포함 나이트 편차 3").
- `FAIRNESS_TOLERANCE`, 가중치 상수는 그대로 쓴다.

### 4. routes
- `/solve`, `/explain`의 제안 검증 재풀이가 `history_load`를 그대로 전달하는지 확인한다(요청 모델을 통째로 넘기면 자동). 테스트 하나로 확인한다.

### 테스트가 최소한 다룰 것
- 모델: 범위 밖 값, 명단 밖 id, 중복 id → 검증 오류
- 솔버: 15명 샘플 병동에서 한 간호사에게 `nights: 8`을 주면, 이번 기간 그 간호사의 N 수가 history 없을 때보다 줄어든다(나이트 공정성 soft 활성).
- 솔버: 나이트 전담 간호사는 history가 있어도 나이트 공정성에서 제외된다.
- 솔버: 주말 history가 많은 간호사의 이번 기간 주말 근무가 줄어든다.
- history_load가 비면 기존 결과와 목적함수 값이 같다.
- 성능: 15명 × 31일 + history_load에서 기존 시간 예산(10초) 안에 푼다.

## Acceptance Criteria

```bash
uv run pytest backend/tests -q
npm run gen:types
npm run test
npm run build && npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 백엔드가 이력 저장소나 DB를 갖지 않고, 요청에 담긴 값만 쓰는가(무상태)?
   - 상수가 `constants.py`에 있는가?
   - `backend/solver/`가 `backend/llm/`을 import하지 않는가?
3. 결과에 따라 `phases/2-periods/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 지난 기간 근무표 전체를 요청에 받지 마라. 이유: ADR-015는 간호사별 요약 수치만 보낸다. 페이로드와 계산을 작게 유지한다.
- 누적 부담을 hard 제약으로 만들지 마라. 이유: 공정성 템플릿(11, 12)은 soft이고, 기존 템플릿 체계 안에서 반영한다.
- 프론트엔드 store나 컴포넌트를 수정하지 마라(생성 타입 재생성은 예외). 이유: step 7~9의 범위다.
- Python 의존성을 추가하지 마라. 이유: ADR-007.
- 기존 테스트를 깨뜨리지 마라.
