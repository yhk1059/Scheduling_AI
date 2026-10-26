"""load_local_env: KEY=VALUE 파싱, 주석·빈 줄·따옴표, 기존 env 보존."""

import os

from backend.env import load_local_env


def test_missing_file_is_noop(tmp_path):
    load_local_env(str(tmp_path / "nope.env"))  # 예외 없음


def test_parses_values_comments_and_quotes(tmp_path, monkeypatch):
    for key in ("T_PLAIN", "T_DOUBLE", "T_SINGLE", "T_HASH", "T_INLINE", "T_EQ"):
        monkeypatch.delenv(key, raising=False)
    path = tmp_path / ".env.local"
    path.write_text(
        "# 주석\n"
        "\n"
        "T_PLAIN=plain\n"
        'T_DOUBLE="double quoted"\n'
        "T_SINGLE='single quoted'\n"
        'T_HASH="a # not comment"\n'
        "T_INLINE=value # 주석\n"
        "T_EQ=a=b\n"
        "   # 들여쓴 주석\n"
        "잘못된 줄\n",
        encoding="utf-8",
    )
    load_local_env(str(path))
    assert os.environ["T_PLAIN"] == "plain"
    assert os.environ["T_DOUBLE"] == "double quoted"
    assert os.environ["T_SINGLE"] == "single quoted"
    assert os.environ["T_HASH"] == "a # not comment"
    assert os.environ["T_INLINE"] == "value"
    assert os.environ["T_EQ"] == "a=b"


def test_does_not_override_existing(tmp_path, monkeypatch):
    monkeypatch.setenv("T_EXISTING", "keep")
    monkeypatch.delenv("T_NEW", raising=False)
    path = tmp_path / ".env.local"
    path.write_text("T_EXISTING=override\nT_NEW=new\n", encoding="utf-8")
    load_local_env(str(path))
    assert os.environ["T_EXISTING"] == "keep"
    assert os.environ["T_NEW"] == "new"
