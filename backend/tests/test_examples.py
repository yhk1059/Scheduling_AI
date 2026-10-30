"""예시 판정(설계 §4.2, 결정 ★6): 고정 시드 샘플 근무표에서 규칙 위반 사례를 결정적으로 고른다."""

from backend.domain.constants import EXAMPLES_PER_RULE, EXAMPLES_SAMPLES, EXAMPLES_SEED
from backend.domain.models import RuleExample
from backend.solver.evaluate import evaluate_rule, pick_examples, sample_schedules
from backend.tests.test_evaluate import NURSES, cmp, cnt, req, require, rule

TAGS = {n["id"]: n.get("tags", []) for n in NURSES}


def examples(r, request=None) -> list[RuleExample]:
    request = (request or req()).model_copy(update={"constraints": [r]})
    schedules = sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES)
    return pick_examples(request, r, schedules, EXAMPLES_PER_RULE)


def code(ex: RuleExample, nid: str, day: int) -> str:
    return ex.cells[nid][ex.days.index(day)]


def assert_shape(ex: RuleExample, length: int = 14) -> None:
    assert 1 <= len(ex.nurse_ids) <= 3 and len(set(ex.nurse_ids)) == len(ex.nurse_ids)
    assert 3 <= len(ex.days) <= 7
    assert ex.days == list(range(ex.days[0], ex.days[-1] + 1)) and 1 <= ex.days[0] and ex.days[-1] <= length
    assert list(ex.cells) == ex.nurse_ids and all(len(row) == len(ex.days) for row in ex.cells.values())
    assert ex.marks and all(nid in ex.nurse_ids and d in ex.days for nid, d in ex.marks)
    assert ex.detail  # 간호사 이름이 없는지는 실명 명단으로 test_routes에서 본다


FORBID_N_D = require(
    "person_day",
    {"any": [cmp(cnt(["N"], offset=[0, 0]), "eq", 0), cmp(cnt(["D"], offset=[1, 1]), "eq", 0)]},
)
LEAVE = require("person", cmp(cnt(not_in=["O"]), "le", {"value": "max"}), people={"ids": ["n1"]}, days={"days": [3, 4, 5]})
CONDITIONAL = require(
    "day", cmp(cnt(["N"], who={"tags": ["책임"]}), "ge", 1), when=cmp(cnt(["N"], who={"tags": ["신규"]}), "ge", 1)
)
PAIR = require("day", cmp(cnt(["N"], who={"ids": ["n1", "n2"]}), "le", 1))


def test_forbid_night_then_day_marks_the_pattern():
    exs = examples(rule(FORBID_N_D))
    assert 1 <= len(exs) <= EXAMPLES_PER_RULE
    for ex in exs:
        assert_shape(ex)
        (nid,) = {n for n, _ in ex.marks}
        days = sorted(d for _, d in ex.marks)
        assert len(days) == 2 and days[1] == days[0] + 1
        assert code(ex, nid, days[0]) == "N" and code(ex, nid, days[1]) == "D"
    assert "나이트" in exs[0].detail or "데이" in exs[0].detail


def test_leave_marks_working_days_in_leave():
    exs = examples(rule(LEAVE, values={"max": 0}))
    assert len(exs) == 1  # 인스턴스는 n1 하나
    (ex,) = exs
    assert_shape(ex)
    assert ex.nurse_ids == ["n1"] and set(ex.days) >= {3, 4, 5}
    assert ex.marks and all(nid == "n1" and d in (3, 4, 5) and code(ex, nid, d) != "O" for nid, d in ex.marks)


def test_conditional_marks_charge_and_shows_newbie_night():
    exs = examples(rule(CONDITIONAL))
    assert exs
    for ex in exs:
        assert_shape(ex)
        (day,) = {d for _, d in ex.marks}
        assert all("책임" in TAGS[nid] and code(ex, nid, day) != "N" for nid, _ in ex.marks)
        assert any("신규" in TAGS[nid] and code(ex, nid, day) == "N" for nid in ex.nurse_ids)


def test_pair_marks_both_nights_on_same_day():
    exs = examples(rule(PAIR))
    assert exs
    for ex in exs:
        assert_shape(ex)
        (day,) = {d for _, d in ex.marks}
        assert sorted(nid for nid, _ in ex.marks) == ["n1", "n2"]
        assert code(ex, "n1", day) == "N" and code(ex, "n2", day) == "N"
        assert "지정한 간호사" in ex.detail


def test_examples_prefer_disjoint_instances():
    exs = examples(rule(PAIR))
    assert len(exs) == EXAMPLES_PER_RULE
    for i, a in enumerate(exs):
        for b in exs[i + 1 :]:
            assert not (set(a.days) & set(b.days))  # 같은 두 사람이라 날이 겹치지 않아야 한다


def test_examples_are_deterministic():
    request = req().model_copy(update={"constraints": [rule(CONDITIONAL)]})
    assert sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES) == sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES)
    for body, values in ((FORBID_N_D, None), (LEAVE, {"max": 0}), (CONDITIONAL, None), (PAIR, None)):
        assert examples(rule(body, values=values)) == examples(rule(body, values=values))


def test_samples_use_active_codes_and_period_length():
    request = req(length=10).model_copy(update={"constraints": [rule(PAIR)]})
    schedules = sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES)
    assert len(schedules) > EXAMPLES_SAMPLES  # 무작위 + 대상 칸 뒤집기
    for a in schedules:
        assert set(a) == {n["id"] for n in NURSES}
        assert all(len(row) == 10 and set(row) <= {"D", "E", "N", "O"} for row in a.values())
    off = sum(row.count("O") for a in schedules[:EXAMPLES_SAMPLES] for row in a.values())
    assert 0.2 < off / (EXAMPLES_SAMPLES * len(NURSES) * 10) < 0.4


def test_marks_are_real_violations():
    """띠가 보인 칸을 샘플 근무표에 대어 보면 그 인스턴스가 실제로 위반이다."""
    r = rule(FORBID_N_D)
    request = req().model_copy(update={"constraints": [r]})
    schedules = sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES)
    for ex in pick_examples(request, r, schedules, EXAMPLES_PER_RULE):
        source = next(
            a for a in schedules
            if all(a[nid][d - 1] == code(ex, nid, d) for nid in ex.nurse_ids for d in ex.days)
        )
        hit = {(v.instance.nurse_id, v.instance.days[0]) for v in evaluate_rule(request, source, r)}
        nid, first = min(ex.marks, key=lambda m: m[1])
        assert (nid, first) in hit


def test_always_holding_rule_has_no_examples():
    no_target_day = require("day", cmp(cnt(["N"]), "ge", 1), days={"kind": "holiday"})
    assert examples(rule(no_target_day), req(holidays=[])) == []
    assert examples(rule(require("day", cmp(cnt(["N"]), "le", 100)))) == []


def test_balance_has_no_examples():
    balance = {"kind": "balance", "shifts": {"in": ["N"]}}
    assert examples(rule(balance, hardness="soft")) == []


def test_short_period_strip_fits_period():
    exs = examples(rule(PAIR), req(length=2, holidays=[]))
    assert exs
    for ex in exs:
        assert ex.days == [1, 2]


def test_deadline_stops_scanning_schedules():
    r = rule(PAIR)
    request = req().model_copy(update={"constraints": [r]})
    schedules = sample_schedules(request, EXAMPLES_SEED, EXAMPLES_SAMPLES)
    assert pick_examples(request, r, schedules, EXAMPLES_PER_RULE, deadline=0.0) == []
