"""Pydantic 모델의 JSON Schema로 lib/types.gen.ts를 만든다. 실행: npm run gen:types"""

import json
import subprocess
from pathlib import Path
from typing import Any

from pydantic import create_model

from backend.domain.models import (
    ConstraintSpec,
    ErrorBody,
    ExplainRequest,
    ExplainResponse,
    ScheduleRequest,
    SolveResponse,
    TranslateRequest,
    TranslateResponse,
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "lib" / "types.gen.ts"
BANNER = "// 자동 생성 파일. 직접 수정하지 말고 `npm run gen:types`로 다시 만든다(backend/domain/models.py 기준)."

TOP_LEVEL: dict[str, Any] = {
    "ScheduleRequest": ScheduleRequest,
    "SolveResponse": SolveResponse,
    "TranslateRequest": TranslateRequest,
    "TranslateResponse": TranslateResponse,
    "ExplainRequest": ExplainRequest,
    "ExplainResponse": ExplainResponse,
    "ErrorBody": ErrorBody,
    "ConstraintSpec": ConstraintSpec,
}


def _strip_titles(node: Any) -> None:
    """필드 title을 지운다. 남겨두면 json2ts가 필드마다 `Id1`, `Days2` 같은 별칭 타입을 만든다."""
    if not isinstance(node, dict):
        return
    node.pop("title", None)
    for key in ("items", "additionalProperties"):
        _strip_titles(node.get(key))
    for key in ("anyOf", "oneOf", "allOf", "prefixItems"):
        for sub in node.get(key, []):
            _strip_titles(sub)
    for sub in node.get("properties", {}).values():
        _strip_titles(sub)


def build_schema() -> dict:
    """최상위 타입을 한 스키마에 모은다. union은 이름 있는 정의로 $defs에 올린다."""
    container = create_model("ApiTypes", **{name: (tp, ...) for name, tp in TOP_LEVEL.items()})
    schema = container.model_json_schema()
    defs = schema.setdefault("$defs", {})
    for name, prop in schema["properties"].items():
        if "$ref" not in prop:
            defs[name] = prop
            schema["properties"][name] = {"$ref": f"#/$defs/{name}"}
    for name, definition in defs.items():
        _strip_titles(definition)
        definition["title"] = name
    return schema


def main() -> None:
    proc = subprocess.run(
        [
            "npx",
            "--no-install",
            "json2ts",
            "--maxItems=-1",
            "--unknownAny",
            f"--bannerComment={BANNER}",
        ],
        input=json.dumps(build_schema()),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=True,
    )
    OUT.write_text(proc.stdout, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
