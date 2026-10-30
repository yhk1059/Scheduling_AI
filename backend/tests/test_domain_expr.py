"""규칙 식 모델(ADR-019, 설계 §2.1~§2.4): 범위, 세기, 비교, 그리고/또는, 조건, 고르게, 조정 가능한 값, 상한."""

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.domain import constants
from backend.domain.models import ConstraintSpec, Rule, ScheduleRequest

spec_adapter = TypeAdapter(ConstraintSpec)


def nurses(n: int = 3) -> list[dict]:
    return [{"id": f"n{i:02d}", "name": f"간호사{i}", "years": i, "tags": []} for i in range(1, n + 1)]


def request(constraints: list[dict], **extra) -> dict:
    return {
        "nurses": nurses(),
        "period": {"start_date": "2026-11-01", "length": 30},
        "constraints": constraints,
        "input_version": 0,
        **extra,
    }


def count(shifts: list[str], **extra) -> dict:
    return {"shifts": {"in": shifts}, **extra}


def cmp(left: dict, op: str, right) -> dict:
    return {"left": left, "op": op, "right": right}


def require(per: str, then: dict, when: dict | None = None, **for_each) -> dict:
    body = {"kind": "require", "for_each": {"per": per, **for_each}, "then": then}
    if when is not None:
        body["when"] = when
    return body


def rule(body: dict, values: dict | None = None, cid: str = "r1", **extra) -> dict:
    return {"id": cid, "type": "rule", "scope": "ward", "source_text": "원문", "values": values or {}, "body": body, **extra}


def val(value: float, label: str = "값") -> dict:
    return {"value": value, "label": label}


def check(raw: dict) -> Rule:
    spec = spec_adapter.validate_python(raw)
    assert isinstance(spec, Rule)
    return spec


# 설계 §2.6 예시 6개
NEW = count(["N"], who={"tags": ["신규"]})
CHARGE = count(["N"], who={"tags": ["책임"]})
EXAMPLES = {
    "conditional": rule(require("day", when=cmp(NEW, "ge", 1), then=cmp(CHARGE, "ge", 1))),
    "pair-apart": rule(require("day", then=cmp(count(["N"], who={"ids": ["n01", "n02"]}), "le", 1))),
    "pair-together": rule(
        require("day", then=cmp(count(["D"], who={"ids": ["n01"]}), "eq", count(["D"], who={"ids": ["n02"]})))
    ),
    "count-vs-count": rule(require("day", then=cmp(CHARGE, "ge", NEW))),
    "weekend-night-off": rule(
        require(
            "person_day",
            when=cmp(count(["N"], offset=[0, 0]), "ge", 1),
            then=cmp(count(["O"], offset=[1, 1]), "eq", 1),
            days={"weekdays": [6]},
        )
    ),
    "night-block-2-3": rule(
        require("person_window", then=cmp(count(["N"]), "le", {"value": "max_len"}), window=4),
        values={"max_len": val(3, "최대 연속 나이트")},
    ),
}


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_design_examples_validate(name):
    r = check(EXAMPLES[name])
    assert r.type == "rule" and r.default is False
    assert ScheduleRequest.model_validate(request([EXAMPLES[name]])).constraints[0] == r


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_rule_roundtrip(name):
    r = check(EXAMPLES[name])
    dumped = spec_adapter.dump_python(r, mode="json")
    assert spec_adapter.validate_python(dumped) == r
    assert "kind" in dumped["body"]


def test_count_defaults():
    r = check(rule(require("day", then=cmp(count(["D"]), "ge", 3))))
    c = r.body.then.left
    assert (c.who, c.offset, c.measure) == (None, None, "count")
    assert r.body.when is None


def test_all_and_any():
    both = {"all": [cmp(count(["D"]), "ge", 3), cmp(count(["D"]), "le", 4)]}
    r = check(rule(require("day", then=both)))
    assert len(r.body.then.all) == 2
    either = {"any": [cmp(count(["N"], offset=[0, 0]), "eq", 0), cmp(count(["D"], offset=[1, 1]), "eq", 0)]}
    assert len(check(rule(require("person_day", then=either))).body.then.any) == 2


@pytest.mark.parametrize("n", [1, 5])
def test_all_any_size(n):
    cmps = [cmp(count(["D"]), "ge", 1)] * n
    for key in ("all", "any"):
        with pytest.raises(ValidationError):
            check(rule(require("day", then={key: cmps})))


def test_cond_is_not_recursive():
    inner = {"all": [cmp(count(["D"]), "ge", 1), cmp(count(["E"]), "ge", 1)]}
    with pytest.raises(ValidationError):
        check(rule(require("day", then={"any": [inner, cmp(count(["N"]), "ge", 1)]})))


# --- 기본 hardness·priority ---


def test_require_defaults_hard_normal():
    r = check(rule(require("day", then=cmp(count(["D"]), "ge", 3))))
    assert (r.hardness, r.priority, r.weight) == ("hard", "normal", constants.PRIORITY_WEIGHTS["normal"])


BALANCE = {"kind": "balance", "shifts": {"in": ["N"]}, "max_gap": {"value": "max_gap"}}


def test_balance_defaults_soft_low():
    r = check(rule(BALANCE, values={"max_gap": val(1, "최대 차이")}))
    assert (r.hardness, r.priority, r.weight) == ("soft", "low", constants.PRIORITY_WEIGHTS["low"])
    assert (r.body.measure, r.body.with_history) == ("count", True)


def test_balance_number_gap_and_explicit_hardness():
    r = check(rule({"kind": "balance", "shifts": {"in": ["N"]}}, hardness="hard"))
    assert (r.hardness, r.body.max_gap) == ("hard", 1)


def test_priority_sets_weight():
    r = check(rule(require("day", then=cmp(count(["D"]), "ge", 3)), hardness="soft", priority="high", weight=1))
    assert r.weight == constants.PRIORITY_WEIGHTS["high"]


# --- ForEach ---


def test_window_only_with_person_window():
    with pytest.raises(ValidationError, match="window"):
        check(rule(require("person_window", then=cmp(count(["N"]), "le", 3))))
    with pytest.raises(ValidationError, match="window"):
        check(rule(require("person", then=cmp(count(["N"]), "le", 3), window=4)))
    for bad in (constants.MIN_WINDOW_DAYS - 1, constants.MAX_WINDOW_DAYS + 1):
        with pytest.raises(ValidationError):
            check(rule(require("person_window", then=cmp(count(["N"]), "le", 3), window=bad)))


@pytest.mark.parametrize("per", ["period", "day", "person", "person_day", "person_week"])
def test_all_pers_accepted(per):
    assert check(rule(require(per, then=cmp(count(["D"]), "ge", 0)))).body.for_each.per == per


# --- 값 ---


def test_values_must_be_used_and_defined():
    with pytest.raises(ValidationError, match="min"):  # 없는 ValueRef
        check(rule(require("day", then=cmp(count(["D"]), "ge", {"value": "min"}))))
    with pytest.raises(ValidationError, match="extra"):  # 쓰이지 않는 값
        check(rule(require("day", then=cmp(count(["D"]), "ge", 3)), values={"extra": val(1)}))


@pytest.mark.parametrize(
    "values",
    [{"Bad": val(1)}, {"1a": val(1)}, {"a" * 25: val(1)}, {"a": val(-1)}, {"a": {"value": 1, "label": ""}}],
    ids=["upper", "digit-first", "too-long", "negative", "empty-label"],
)
def test_bad_values_rejected(values):
    (name,) = values
    with pytest.raises(ValidationError):
        check(rule(require("day", then=cmp(count(["D"]), "ge", {"value": name})), values=values))


def test_values_limit():
    names = [f"v{i}" for i in range(constants.MAX_RULE_VALUES + 1)]
    cmps = [cmp(count(["D"]), "ge", {"value": n}) for n in names]
    values = {n: val(1) for n in names}
    with pytest.raises(ValidationError):
        check(rule(require("day", when={"all": cmps[:2]}, then={"all": cmps[2:]}), values=values))
    ok = names[: constants.MAX_RULE_VALUES]
    ok_cmps = [cmp(count(["D"]), "ge", {"value": n}) for n in ok]
    r = check(rule(require("day", when={"all": ok_cmps[:2]}, then={"all": ok_cmps[2:]}), values={n: val(1) for n in ok}))
    assert len(r.values) == constants.MAX_RULE_VALUES


# --- 상한 ---


def test_cmp_limit():
    c = cmp(count(["D"]), "ge", 1)
    six = check(rule(require("day", when={"all": [c, c]}, then={"all": [c] * 4})))
    assert six
    with pytest.raises(ValidationError, match=str(constants.MAX_RULE_CMPS)):
        check(rule(require("day", when={"all": [c] * 3}, then={"all": [c] * 4})))


def test_offset_only_on_day_ranges():
    with pytest.raises(ValidationError, match="offset"):
        check(rule(require("person", then=cmp(count(["N"], offset=[0, 1]), "le", 1))))
    with pytest.raises(ValidationError, match="offset"):
        check(rule(require("person_week", when=cmp(count(["N"], offset=[0, 0]), "ge", 1), then=cmp(count(["O"]), "ge", 1))))
    assert check(rule(require("day", then=cmp(count(["N"], offset=[-1, 0]), "le", 3))))


@pytest.mark.parametrize(
    "offset",
    [
        [constants.MIN_OFFSET - 1, 0],
        [0, constants.MAX_OFFSET + 1],
        [2, 1],
        [-7, 7],  # 폭 15일
    ],
    ids=["below", "above", "reversed", "span-15"],
)
def test_bad_offset_rejected(offset):
    with pytest.raises(ValidationError):
        check(rule(require("person_day", then=cmp(count(["N"], offset=offset), "le", 1))))


def test_offset_limits_accepted():
    for offset in ([constants.MIN_OFFSET, 6], [1, constants.MAX_OFFSET], [-6, 7]):
        assert check(rule(require("person_day", then=cmp(count(["N"], offset=offset), "le", 1))))


# --- 422 (ScheduleRequest 검증) ---


@pytest.mark.parametrize(
    "raw",
    [
        rule(require("person", then=cmp(count(["N"], offset=[0, 1]), "le", 1))),
        rule(require("day", then=cmp(count(["D"]), "ge", {"value": "nope"}))),
        rule(require("day", when={"all": [cmp(count(["D"]), "ge", 1)] * 3}, then={"all": [cmp(count(["D"]), "ge", 1)] * 4})),
        rule(require("person_day", then=cmp(count(["N"], offset=[-7, 7]), "le", 1))),
    ],
    ids=["offset-on-person", "missing-value", "seven-cmps", "span-15"],
)
def test_invalid_rules_fail_request(raw):
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([raw]))


# --- 참조 무결성 ---


def test_rule_refs_checked():
    bad_id = rule(require("day", then=cmp(count(["N"], who={"ids": ["n01", "n99"]}), "le", 1)), cid="pair")
    with pytest.raises(ValidationError, match="pair.*n99"):
        ScheduleRequest.model_validate(request([bad_id]))
    bad_for_each = rule(require("person", then=cmp(count(["O"]), "ge", 1), people={"ids": ["n77"]}), cid="fe")
    with pytest.raises(ValidationError, match="fe.*n77"):
        ScheduleRequest.model_validate(request([bad_for_each]))
    bad_day = rule(require("person", then=cmp(count(["O"], days={"days": [31]}), "ge", 1)), cid="dd")
    with pytest.raises(ValidationError, match="dd.*31"):
        ScheduleRequest.model_validate(request([bad_day]))
    bad_for_each_day = rule(require("day", then=cmp(count(["D"]), "ge", 1), days={"days": [0]}), cid="fd")
    with pytest.raises(ValidationError, match="fd"):
        ScheduleRequest.model_validate(request([bad_for_each_day]))


def test_rule_codes_checked():
    when_m = rule(require("day", when=cmp(count(["M"]), "ge", 1), then=cmp(count(["D"]), "ge", 1)), cid="mm")
    with pytest.raises(ValidationError, match="mm.*M"):
        ScheduleRequest.model_validate(request([when_m]))
    right_m = rule(require("day", then=cmp(count(["D"]), "ge", count(["M"]))), cid="rm")
    with pytest.raises(ValidationError, match="rm.*M"):
        ScheduleRequest.model_validate(request([right_m]))
    bal = rule({"kind": "balance", "shifts": {"not_in": ["M"]}}, cid="bm")
    with pytest.raises(ValidationError, match="bm.*M"):
        ScheduleRequest.model_validate(request([bal]))
    cfg = {"shifts": [{"code": c, "name": c, "hours": 8} for c in "DENM"] + [{"code": "O", "name": "휴무", "hours": 0}]}
    assert ScheduleRequest.model_validate(request([when_m, right_m, bal], config=cfg))


def test_balance_refs_checked():
    bal = rule({"kind": "balance", "people": {"ids": ["n42"]}, "days": {"days": [40]}, "shifts": {"in": ["N"]}}, cid="bb")
    with pytest.raises(ValidationError, match="bb.*n42") as e:
        ScheduleRequest.model_validate(request([bal]))
    assert "40" in str(e.value)


def test_unknown_tags_pass():
    r = rule(require("day", then=cmp(count(["N"], who={"tags": ["없는태그"]}), "ge", 1)))
    assert ScheduleRequest.model_validate(request([r]))


def test_blocks_no_longer_accepted_beside_rules():
    """블록은 식으로 통일됐다(ADR-019 ★2). 요청은 rule | fixed_assignment만 받는다."""
    blk = {"id": "b1", "type": "count", "scope": "ward", "source_text": "원문",
           "params": {"shifts": {"in": ["D"]}, "per": "day", "min": 1}}
    with pytest.raises(ValidationError):
        ScheduleRequest.model_validate(request([blk, EXAMPLES["pair-apart"]]))
    req = ScheduleRequest.model_validate(request([EXAMPLES["pair-apart"]]))
    assert [c.type for c in req.constraints] == ["rule"]


# --- 값 바꾸기(제안 set_value·카드 [수정]) ---

from backend.tests import rules as R  # noqa: E402
from backend.domain.models import with_value  # noqa: E402


def test_with_value_changes_only_value():
    cov = Rule.model_validate(R.coverage("D", "weekday", 3, 3))
    name = next(iter(cov.values))
    out = with_value(cov, name, 2)
    assert out.values[name].value == 2 and out.body == cov.body
    assert cov.values[name].value == 3  # 원본은 그대로


def test_with_value_max_run_moves_window():
    """최대 연속 k일은 k+1일 창마다 ≤k다. 값만 바꾸면 의미가 어긋나므로 창도 값+1로 바꾼다(클라이언트 withRuleValue와 같음)."""
    mx = Rule.model_validate(R.max_nights("mx", 3))
    out = with_value(mx, "max_len", 4)
    assert out.values["max_len"].value == 4 and out.body.for_each.window == 5


def test_with_value_max_run_window_bounds():
    mx = Rule.model_validate(R.max_nights("mx", 3))
    assert with_value(mx, "max_len", 13).body.for_each.window == 14
    with pytest.raises(ValidationError):
        with_value(mx, "max_len", 14)  # 창 15일은 상한 밖


def test_with_value_keeps_window_of_other_window_rules():
    """창 길이가 값+1이 아닌 창 규칙(7일마다 휴무 2일 이상 등)은 창을 그대로 둔다."""
    wo = Rule.model_validate(R.window_off("wo", 7, 2))
    out = with_value(wo, next(iter(wo.values)), 3)
    assert out.body.for_each.window == 7
