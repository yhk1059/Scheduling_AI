"""상한, 시간 예산, 가중치. 다른 모듈은 숫자를 하드코딩하지 말고 여기서 import한다."""

# 입력 상한 (초과 시 413)
MAX_NURSES = 40
MAX_CONSTRAINTS = 200  # 고정 근무(칸 고정, 지난 날짜 잠금)를 뺀 규칙·요청
MAX_TEXT_CHARS = 1000
CARRY_OVER_DAYS = 7
MAX_PERIOD_DAYS = 31
MAX_FIXED_ASSIGNMENTS = MAX_NURSES * MAX_PERIOD_DAYS  # 고정 근무는 칸마다 하나
HISTORY_DAYS = 28  # 누적 부담 창(일). 최근 4주 나이트·주말 근무 수의 상한
MAX_SHIFT_CODES = 8  # 병동 근무 코드 수(O 포함)
MAX_TAGS_PER_NURSE = 5
MAX_TAG_CHARS = 10
MAX_FORBID_PATTERNS = 4  # 순서 블록의 금지 패턴 수
FORBID_PATTERN_LEN = (2, 4)  # 금지 패턴 한 개의 칸 수 범위
COUNT_WINDOW_DAYS = (2, 14)  # 세기 블록 per=person_window의 창 길이 범위

# 병동 구조 기본값: (코드, 이름, 시간). O는 휴무이고 필수다.
OFF_CODE = "O"
DEFAULT_SHIFTS: list[tuple[str, str, float]] = [
    ("D", "데이", 8),
    ("E", "이브닝", 8),
    ("N", "나이트", 8),
    (OFF_CODE, "휴무", 0),
]
NIGHT_ONLY_TAG = "나이트전담"

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
# 블록의 중요도 → soft 위반 1단위당 페널티(ADR-018). 보통·낮음은 위 기본값과 같다.
PRIORITY_WEIGHTS: dict[str, int] = {"high": 30, "normal": 10, "low": 5}
# 근무 시간(measure=hours)은 분 단위 정수로 계산한다(근무 시간은 0.5시간 단위라 정수가 된다).
MINUTES_PER_HOUR = 60
# 시간 기준 soft 블록의 위반량 단위: 기본 근무 하나(8시간). 위반 분 ÷ 480을 올림한 정수 × 가중치가 페널티다
# (8시간 초과 = 1단위, 1분~8시간 초과도 1단위, 8시간 1분 초과 = 2단위). 개수 기준 블록은 1개 = 1단위.
BASE_SHIFT_HOURS = 8
FAIRNESS_TOLERANCE = 1  # 공정성 편차가 이 값 이하면 soft 위반으로 나열하지 않는다
DIFF_WEIGHT = 20  # 재스케줄 시 변경 칸 1개당 페널티
