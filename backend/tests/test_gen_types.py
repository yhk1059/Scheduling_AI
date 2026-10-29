"""gen_types: 최상위 모델과 union이 이름 있는 정의로 스키마에 들어가는지 확인한다."""

from backend.gen_types import build_schema

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
    assert refs == {"CountRule", "SequenceRule", "BalanceRule", "FixedAssignment"}
    refs = {item["$ref"].rsplit("/", 1)[-1] for item in defs["SolveResponse"]["oneOf"]}
    assert refs == {"SolveOk", "SolveInfeasible", "SolveTimeout"}
