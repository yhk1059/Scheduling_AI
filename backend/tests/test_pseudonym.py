"""가명 처리: 성명 전체, 유일 이름 치환, 공유 이름 미치환, 복원 왕복."""

from backend.domain.models import Employee
from backend.llm.pseudonym import fix_particle, has_final_consonant, pseudonymize, restore

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
    assert restore("e01은 15일, e10은 3일", EMPLOYEES) == "이영희는 15일, 최지훈은 3일"


def test_restore_does_not_touch_longer_ids():
    employees = [Employee(id="n1", name="가나다"), Employee(id="e10", name="라마바")]
    assert restore("e10과 n1", employees) == "라마바와 가나다"


def test_round_trip():
    text = "이영희 15~17일 휴가, 지훈 나이트 금지"
    assert restore(pseudonymize(text, EMPLOYEES), EMPLOYEES) == "이영희 15~17일 휴가, 최지훈 나이트 금지"


# --- 복원 뒤 조사 맞추기 (LLM은 id에 맞는 조사를 붙인다) ---


def test_has_final_consonant():
    assert has_final_consonant("최지훈") is True
    assert has_final_consonant("이영희") is False
    assert has_final_consonant("이영희”) ") is False  # 닫는 기호·공백은 건너뛴다
    assert has_final_consonant("Kim1") is True  # 일
    assert has_final_consonant("Kim2") is False  # 이
    assert has_final_consonant("Ann") is True  # 엔
    assert has_final_consonant("Bob") is False  # 비
    assert has_final_consonant("홍길동!") is None
    assert has_final_consonant("") is None


def test_fix_particle():
    assert fix_particle("이영희", "이 마감") == "가 마감"
    assert fix_particle("최지훈", "는") == "은"
    assert fix_particle("이영희", "으로") == "로"
    assert fix_particle("서울", "으로") == "로"  # ㄹ 받침 뒤
    assert fix_particle("최지훈", "로.") == "으로."
    assert fix_particle("이영희", "이에요") == "예요"
    assert fix_particle("최지훈", "예요") == "이에요"
    assert fix_particle("최지훈", "은요") == "은요"  # 조사 뒤 한글이 이어지면 그대로
    assert fix_particle("이영희", " 15일") == " 15일"


def test_restore_fixes_particles():
    assert restore("e01이 마감을 세 번 해요", EMPLOYEES) == "이영희가 마감을 세 번 해요"
    assert restore("e02는 주말 휴무", EMPLOYEES) == "김민수는 주말 휴무"
    assert restore("e10을 빼요", EMPLOYEES) == "최지훈을 빼요"
    assert restore("e01으로 바꿔요", EMPLOYEES) == "이영희로 바꿔요"
    assert restore("e01과 e02가 같은 날", EMPLOYEES) == "이영희와 김민수가 같은 날"
    assert restore("e01이에요.", EMPLOYEES) == "이영희예요."


def test_restore_keeps_non_particles():
    assert restore("e03은요", EMPLOYEES) == "박민수은요"
    assert restore("e01 15~17일 휴가", EMPLOYEES) == "이영희 15~17일 휴가"
    assert restore("e10은 3일", EMPLOYEES) == "최지훈은 3일"  # 이미 맞는 조사


def test_restore_reads_latin_and_digit_names():
    employees = [Employee(id="e01", name="Kim2"), Employee(id="e02", name="Lee1")]
    assert restore("e01은 마감, e02는 오픈", employees) == "Kim2는 마감, Lee1은 오픈"
