"""상한, 시간 예산, 가중치. 다른 모듈은 숫자를 하드코딩하지 말고 여기서 import한다."""

# 입력 상한 (초과 시 413)
MAX_EMPLOYEES = 40
MAX_CONSTRAINTS = 200  # 고정 근무(칸 고정, 지난 날짜 잠금)를 뺀 규칙·요청
MAX_TEXT_CHARS = 1000
CARRY_OVER_DAYS = 7
MAX_PERIOD_DAYS = 31
MAX_FIXED_ASSIGNMENTS = MAX_EMPLOYEES * MAX_PERIOD_DAYS  # 고정 근무는 칸마다 하나
HISTORY_DAYS = 28  # 누적 부담 창(일). history 원본 행의 최대 길이
MAX_SHIFT_CODES = 8  # 매장 근무 코드 수(O 포함)
MAX_TAGS_PER_EMPLOYEE = 5
MAX_TAG_CHARS = 10
# 블록 형식 상한(초과 시 422). 최악 매장 벤치(python -m backend.bench)가 시간 예산 안에 해를 내는 값이다
MAX_PATTERNS = 4  # 순서 블록의 금지 패턴 수
MAX_PATTERN_LEN = 4  # 금지 패턴 한 개의 칸 수
MIN_WINDOW_DAYS = 2  # 세기 블록 per=person_window의 창 길이
MAX_WINDOW_DAYS = 14
# 규칙 식 상한(ADR-019, 초과 시 422)
MAX_RULE_VALUES = 5  # 규칙 하나의 조정 가능한 값 수
MAX_RULE_CMPS = 6  # 규칙 하나의 비교 수(when + then). 그리고/또는 하나는 2..4개
MIN_COND_CMPS = 2
MAX_COND_CMPS = 4
MIN_OFFSET = -7  # 세기의 날짜 이동(d+a..d+b)
MAX_OFFSET = 14
MAX_OFFSET_SPAN = 14  # 이동 구간의 날 수(b − a + 1)

# 매장 구조 기본값: (코드, 이름, 시간). O는 휴무이고 필수다.
OFF_CODE = "O"
DEFAULT_SHIFTS: list[tuple[str, str, float]] = [
    ("D", "데이", 8),
    ("E", "이브닝", 8),
    ("N", "나이트", 8),
    (OFF_CODE, "휴무", 0),
]

# LLM
LLM_MAX_RETRIES = 2
LLM_TIMEOUT_S = 30
LLM_MAX_TOKENS = 2048
LLM_EFFORT = "medium"
MAX_PROPOSALS = 3
DEFAULT_MODEL = "claude-sonnet-5-5"

# 솔버 시간 예산 (초)
SOLVE_TIME_LIMIT_S = 10
CONFLICT_TIME_LIMIT_S = 5
PROPOSAL_VERIFY_TIME_LIMIT_S = 3
EXAMPLES_TIME_BUDGET_S = 1  # /translate 예시 판정 전체. 넘으면 남은 규칙은 예시 없음

# 예시 판정(ADR-019, 설계 §4.2): 고정 시드 샘플 근무표에서 위반 사례를 고른다
EXAMPLES_PER_RULE = 3
EXAMPLES_SAMPLES = 8  # 무작위 근무표 수(규칙이 세는 칸을 뒤집은 변형은 따로 더한다)
EXAMPLES_SEED = 20261030
EXAMPLES_OFF_RATIO = 0.3  # 샘플 근무표의 휴무 비율
EXAMPLES_MAX_EMPLOYEES = 3  # 띠 하나에 보일 직원 수
EXAMPLES_MIN_DAYS = 3  # 띠의 날 수(기간이 더 짧으면 기간 전체)
EXAMPLES_MAX_DAYS = 7

# 가중치
# 블록의 중요도 → soft 위반 1단위당 페널티(ADR-018). 보통 = 템플릿 기본 가중치, 낮음 = 템플릿 공정성 기본 가중치.
PRIORITY_WEIGHTS: dict[str, int] = {"high": 30, "normal": 10, "low": 5}
# 근무 시간(measure=hours)은 분 단위 정수로 계산한다(근무 시간은 0.5시간 단위라 정수가 된다).
MINUTES_PER_HOUR = 60
# 시간 기준 soft 블록의 위반량 단위: 기본 근무 하나(8시간). 위반 분 ÷ 480을 올림한 정수 × 가중치가 페널티다
# (8시간 초과 = 1단위, 1분~8시간 초과도 1단위, 8시간 1분 초과 = 2단위). 개수 기준 블록은 1개 = 1단위.
BASE_SHIFT_HOURS = 8
FAIRNESS_TOLERANCE = 1  # 공정성 편차가 이 값 이하면 soft 위반으로 나열하지 않는다
DIFF_WEIGHT = 20  # 재스케줄 시 변경 칸 1개당 페널티
