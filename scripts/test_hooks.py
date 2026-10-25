"""
.claude/settings.json 훅 테스트.
훅 command를 실제 bash로 실행해 exit code를 검증한다.
"""

import json
import subprocess
from pathlib import Path

import pytest

SETTINGS = Path(__file__).resolve().parent.parent / ".claude" / "settings.json"


def _pre_tool_use_command() -> str:
    hooks = json.loads(SETTINGS.read_text(encoding="utf-8"))["hooks"]
    return hooks["PreToolUse"][0]["hooks"][0]["command"]


def _run_pre_tool_use(command: str) -> int:
    payload = json.dumps({"tool_input": {"command": command}})
    r = subprocess.run(["bash", "-c", _pre_tool_use_command()],
                       input=payload, capture_output=True, text=True)
    return r.returncode


class TestPreToolUseBlocks:
    @pytest.mark.parametrize("command", [
        "rm -rf build",
        "rm -fr build",
        "rm -Rf build",
        "rm -rfv build",
        "rm -r -f build",
        "rm -f -r build",
        "rm --recursive --force build",
        "rm build -rf",
        "/bin/rm -rf build",
        "cd src && rm -rf dist",
        "git push --force",
        "git push -f",
        "git push origin main -f",
        "git push --force-with-lease",
        "git push origin +main",
        "git -C repo push --force",
        "git reset --hard",
        "git reset --hard HEAD~1",
        "git -C repo reset --hard",
        "DROP TABLE users",
        "drop table users",
    ])
    def test_blocked(self, command):
        assert _run_pre_tool_use(command) == 2


class TestPreToolUseAllows:
    @pytest.mark.parametrize("command", [
        "ls -la",
        "rm file.txt",
        "rm -f file.txt",
        "rm -r build",
        "rm -r build-conf",
        "git push",
        "git push -u origin feat-x",
        "git push --follow-tags",
        "git reset --soft HEAD~1",
        "git status",
        "npm run format",
        "SELECT * FROM tables",
    ])
    def test_allowed(self, command):
        assert _run_pre_tool_use(command) == 0
