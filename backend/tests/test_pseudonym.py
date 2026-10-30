"""가명 처리: 성명 전체, 유일 이름 치환, 공유 이름 미치환, 복원 왕복."""

from backend.domain.models import Employee
from backend.llm.pseudonym import pseudonymize, restore

EMPLOYEES = [
    Employee(id="e01", name="이영희"),
    Employee(id="e02", name="김민수"),
    Employee(id="e03", name="박민수"),
    Employee(id="e10", name="최지훈"),
]


def test_full_name_replaced():
    assert pseudonymize("이영희 15~17일 휴가", EMPLOYEES) == "e01 15~17일 휴가"


def test_unique_given_name_replaced():
    assert pseudonymize("영희는 나이트 빼줘", EMPLOYEES) == "e01는 나이트 빼줘"


def test_shared_given_name_not_replaced():
    # 민수는 김민수·박민수가 공유한다
    assert pseudonymize("민수 주말 오프", EMPLOYEES) == "민수 주말 오프"
    # 성명 전체는 치환된다
    assert pseudonymize("김민수, 박민수 주말 오프", EMPLOYEES) == "e02, e03 주말 오프"


def test_full_name_before_given_name():
    # 긴 이름부터 치환해서 "최"가 남지 않는다
    assert pseudonymize("최지훈과 지훈", EMPLOYEES) == "e10과 e10"


def test_restore():
    assert restore("e01은 15일, e10은 3일", EMPLOYEES) == "이영희은 15일, 최지훈은 3일"


def test_restore_does_not_touch_longer_ids():
    employees = [Employee(id="n1", name="가나다"), Employee(id="e10", name="라마바")]
    assert restore("e10과 n1", employees) == "라마바과 가나다"


def test_round_trip():
    text = "이영희 15~17일 휴가, 지훈 나이트 금지"
    assert restore(pseudonymize(text, EMPLOYEES), EMPLOYEES) == "이영희 15~17일 휴가, 최지훈 나이트 금지"
