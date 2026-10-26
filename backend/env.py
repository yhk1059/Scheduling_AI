"""로컬 전용 .env.local 로더. 이미 설정된 env는 덮어쓰지 않는다(Vercel에서는 프로젝트 env를 쓴다)."""

import os
from pathlib import Path


def _parse_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value.split(" #", 1)[0].strip()


def load_local_env(path: str = ".env.local") -> None:
    file = Path(path)
    if not file.is_file():
        return
    for line in file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, _parse_value(raw))
