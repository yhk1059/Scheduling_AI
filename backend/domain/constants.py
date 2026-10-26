"""상한, 시간 예산, 가중치. 다른 모듈은 숫자를 하드코딩하지 말고 여기서 import한다."""

# 입력 상한 (초과 시 413)
MAX_NURSES = 40
MAX_CONSTRAINTS = 200
MAX_TEXT_CHARS = 1000
CARRY_OVER_DAYS = 7

# LLM
LLM_MAX_RETRIES = 2
LLM_TIMEOUT_S = 30
LLM_MAX_TOKENS = 2048
MAX_PROPOSALS = 3
DEFAULT_MODEL = "claude-sonnet-5-5"

# 솔버 시간 예산 (초)
SOLVE_TIME_LIMIT_S = 10
CONFLICT_TIME_LIMIT_S = 5
PROPOSAL_VERIFY_TIME_LIMIT_S = 3

# 가중치
DEFAULT_WEIGHT = 10  # hard 기본 템플릿을 soft로 바꿨을 때 위반 1건당 페널티
DEFAULT_SOFT_WEIGHTS: dict[str, int] = {
    "shift_preference": 10,
    "night_fairness": 5,
    "weekend_fairness": 5,
}
FAIRNESS_TOLERANCE = 1  # 공정성 편차가 이 값 이하면 soft 위반으로 나열하지 않는다
DIFF_WEIGHT = 20  # 재스케줄 시 변경 칸 1개당 페널티
