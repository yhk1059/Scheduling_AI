"""LLM 호출 전 이름 가명화(ADR-009). 가명은 employee.id다."""

import re

from backend.domain.models import Employee

_ID_EDGE = "A-Za-z0-9_"


def _alias_map(employees: list[Employee]) -> dict[str, str]:
    """성명 전체와, 명단에서 유일한 이름(성 제외, 2자 이상) → employee.id."""
    given = [n.name[1:] for n in employees]
    aliases: dict[str, str] = {}
    for n, g in zip(employees, given):
        if len(g) >= 2 and given.count(g) == 1:
            aliases[g] = n.id
    for n in employees:
        aliases[n.name] = n.id
    return aliases


def _replace(text: str, mapping: dict[str, str], pattern_of) -> str:
    if not mapping:
        return text
    keys = sorted(mapping, key=len, reverse=True)
    pattern = re.compile("|".join(pattern_of(re.escape(k)) for k in keys))
    return pattern.sub(lambda m: mapping[m.group(0)], text)


def pseudonymize(text: str, employees: list[Employee]) -> str:
    return _replace(text, _alias_map(employees), lambda k: k)


def restore(text: str, employees: list[Employee]) -> str:
    mapping = {n.id: n.name for n in employees}
    return _replace(text, mapping, lambda k: f"(?<![{_ID_EDGE}]){k}(?![{_ID_EDGE}])")
