"""eval/dataset.jsonl의 기대값을 식 규칙으로 기계 변환한다(규칙 식 설계 §2.5·§7).

uv run python eval/convert_dataset.py

1. set이 없는 케이스(옛 템플릿 44건)는 블록으로 바꾸고 "set": "legacy"를 붙인다. 희망 근무의 min(대상 날짜 수)은 케이스의 기간·공휴일로 센다.
2. 블록 기대값(count·sequence·balance)은 block_to_rules로 식 규칙으로 바꾼다. 금지 패턴 여럿·min_len과 max_len은 규칙이 나뉜다.
이미 바꾼 케이스는 그대로 둔다(여러 번 실행해도 같다).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pydantic import TypeAdapter  # noqa: E402

from backend.domain.convert import block_to_rules, legacy_to_block  # noqa: E402
from backend.domain.models import ConstraintSpec, Period  # noqa: E402

DATASET = ROOT / "eval" / "dataset.jsonl"
SAMPLE = ROOT / "lib" / "samples" / "ward-15.json"

_adapter = TypeAdapter(ConstraintSpec)
_FILLER = {"id": "eval", "scope": "ward", "source_text": "eval"}
_EXCLUDE = {"id", "scope", "source_text", "enabled", "weight"}
_BLOCK_TYPES = ("count", "sequence", "balance")


def _dump(spec) -> dict:
    return _adapter.dump_python(spec, mode="json", exclude=_EXCLUDE, exclude_defaults=True)


def blocks_to_rules(case: dict) -> dict:
    """블록 기대값을 식 규칙으로. 식·칸 고정은 그대로."""
    constraints = case["expected"].get("constraints", [])
    if not any(c.get("type") in _BLOCK_TYPES for c in constraints):
        return case
    rules = [_dump(r) for c in constraints for r in block_to_rules(_adapter.validate_python({**_FILLER, **c}))]
    return {**case, "expected": {**case["expected"], "constraints": rules}}


def convert_case(case: dict, ward: dict) -> dict:
    if "set" in case:
        return blocks_to_rules(case)
    period = Period(**case.get("period", ward["period"]))
    holidays = case.get("holidays", ward["holidays"])
    expected = dict(case["expected"])
    if "constraints" in expected:
        blocks = [legacy_to_block(_adapter.validate_python({**_FILLER, **c}), period, holidays) for c in expected["constraints"]]
        expected["constraints"] = [_dump(b) for b in blocks]
    keys = list(case)
    out = {"id": case["id"], "set": "legacy", **{k: case[k] for k in keys if k != "id"}}
    out["expected"] = expected
    return blocks_to_rules(out)


def main() -> None:
    ward = json.loads(SAMPLE.read_text(encoding="utf-8"))
    lines = [line for line in DATASET.read_text(encoding="utf-8").splitlines() if line.strip()]
    cases = [convert_case(json.loads(line), ward) for line in lines]
    DATASET.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases), encoding="utf-8")
    print(f"{len(cases)}개 케이스 변환")


if __name__ == "__main__":
    main()
