"""LLM 호출 전 이름 가명화(ADR-009). 가명은 employee.id다."""

import re

from backend.domain.models import Employee

_ID_EDGE = "A-Za-z0-9_"

# (받침 있음, 받침 없음). 긴 것 먼저
_PARTICLES: list[tuple[str, str]] = [("이에요", "예요"), ("으로", "로"), ("이", "가"), ("은", "는"), ("을", "를"), ("과", "와")]
_WORD_CHAR = re.compile(r"[가-힣A-Za-z0-9_]")
_TRAILING = re.compile(r"[”\"’')」』\]\s]+$")
# 숫자·영문자를 읽는 소리의 받침(lib/wording.ts josa와 같은 표): 0 영, 1 일(ㄹ), 3 삼, 6 육, 7 칠(ㄹ), 8 팔(ㄹ) / 엘·알(ㄹ), 엠, 엔.
_DIGIT_FINAL = {"0": "final", "1": "rieul", "3": "final", "6": "final", "7": "rieul", "8": "rieul"}
_LETTER_FINAL = {"L": "rieul", "R": "rieul", "M": "final", "N": "final"}
_RIEUL = 8  # 종성 ㄹ


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


def _final(word: str) -> str | None:
    """마지막 글자의 받침: "none" | "final" | "rieul", 판단 못 하면 None."""
    stripped = _TRAILING.sub("", word)
    if not stripped:
        return None
    last = stripped[-1]
    if "가" <= last <= "힣":
        jong = (ord(last) - 0xAC00) % 28
        return "none" if jong == 0 else "rieul" if jong == _RIEUL else "final"
    if last.isascii() and last.isdigit():
        return _DIGIT_FINAL.get(last, "none")
    if last.isascii() and last.isalpha():
        return _LETTER_FINAL.get(last.upper(), "none")
    return None


def has_final_consonant(word: str) -> bool | None:
    """마지막 글자(닫는 기호·공백은 건너뛴다)의 받침 여부. 한글은 받침, 숫자·영문자는 읽는 소리. 판단 못 하면 None."""
    f = _final(word)
    return None if f is None else f != "none"


def fix_particle(name: str, following: str) -> str:
    """following이 조사로 시작하면 name의 받침에 맞는 쪽으로 바꾼 following. "으로/로"는 ㄹ 받침 뒤에서 "로".

    조사 다음 글자가 공백·문장 부호·끝일 때만 고친다. 받침을 판단 못 하면 그대로다.
    """
    f = _final(name)
    if f is None:
        return following
    for with_final, without in _PARTICLES:
        for p in (with_final, without):
            if not following.startswith(p):
                continue
            rest = following[len(p) :]
            if rest and _WORD_CHAR.match(rest):
                return following
            use_final = f == "final" or (f == "rieul" and with_final != "으로")
            return (with_final if use_final else without) + rest
    return following


def pseudonymize(text: str, employees: list[Employee]) -> str:
    return _replace(text, _alias_map(employees), lambda k: k)


def restore(text: str, employees: list[Employee]) -> str:
    """id를 이름으로 되돌리고, 바로 뒤의 조사를 이름의 받침에 맞게 고친다."""
    mapping = {n.id: n.name for n in employees}
    if not mapping:
        return text
    ids = "|".join(re.escape(k) for k in sorted(mapping, key=len, reverse=True))
    particles = "|".join(re.escape(p) for pair in _PARTICLES for p in pair)
    pattern = re.compile(f"(?<![{_ID_EDGE}])({ids})(?![{_ID_EDGE}])((?:{particles})(?![가-힣{_ID_EDGE}]))?")

    def sub(m: re.Match[str]) -> str:
        name = mapping[m.group(1)]
        return name + fix_particle(name, m.group(2) or "")

    return pattern.sub(sub, text)
