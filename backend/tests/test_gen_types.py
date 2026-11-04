"""gen_types: 최상위 모델과 union이 이름 있는 정의로 스키마에 들어가는지 확인한다."""

from backend.gen_types import BANNER, build_schema

TOP_LEVEL = [
    "ScheduleRequest",
    "SolveResponse",
    "TranslateRequest",
    "TranslateResponse",
    "ExplainRequest",
    "ExplainResponse",
    "ErrorBody",
    "ConstraintSpec",
]


def test_schema_has_named_top_level_definitions():
    schema = build_schema()
    defs = schema["$defs"]
    for name in TOP_LEVEL:
        assert name in defs, name
    assert {"SolveOk", "SolveInfeasible", "SolveTimeout"} <= set(defs)


def test_unions_reference_their_members():
    defs = build_schema()["$defs"]
    refs = {item["$ref"].rsplit("/", 1)[-1] for item in defs["ConstraintSpec"]["oneOf"]}
    assert refs == {"Rule", "FixedAssignment"}
    assert not {"CountRule", "SequenceRule", "BalanceRule", "CountParams"} & set(defs)
    refs = {item["$ref"].rsplit("/", 1)[-1] for item in defs["SolveResponse"]["oneOf"]}
    assert refs == {"SolveOk", "SolveInfeasible", "SolveTimeout"}


def test_banner_keeps_eslint_on():
    # 생성 결과도 린트를 받는다. 쓰이지 않는 disable 주석은 eslint 경고가 된다.
    assert "eslint-disable" not in BANNER
