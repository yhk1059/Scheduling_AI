"""
.claude/settings.json 훅 테스트.
훅 command를 실제 bash로 실행해 exit code를 검증한다.
"""

import json
import shutil
import subprocess
import tempfile
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


TDD_GUARD = SETTINGS.parent.parent / "scripts" / "hooks" / "tdd-guard.sh"


def _run_tdd_guard(file_path: str) -> str:
    payload = json.dumps({"tool_input": {"file_path": file_path}})
    r = subprocess.run(["bash", str(TDD_GUARD)],
                       input=payload, capture_output=True, text=True)
    assert r.returncode == 0
    return r.stdout


def _denied(stdout: str) -> bool:
    if not stdout.strip():
        return False
    return json.loads(stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"


@pytest.fixture
def work_dir():
    # pytest tmp_path는 경로에 "test"가 들어가 가드의 *test* 예외에 걸리므로 별도 디렉터리를 쓴다.
    d = Path(tempfile.mkdtemp(prefix="guard-"))
    yield d
    shutil.rmtree(d)


class TestTddGuard:
    def test_registered_for_edit_write(self):
        hooks = json.loads(SETTINGS.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
        entry = next(h for h in hooks if h["matcher"] == "Edit|Write")
        assert entry["hooks"][0]["command"] == "$CLAUDE_PROJECT_DIR/scripts/hooks/tdd-guard.sh"

    def test_denies_source_without_test(self, work_dir):
        src = work_dir / "src" / "lib" / "foo.ts"
        src.parent.mkdir(parents=True)
        assert _denied(_run_tdd_guard(str(src)))

    def test_allows_source_with_sibling_test(self, work_dir):
        d = work_dir / "src" / "lib"
        d.mkdir(parents=True)
        (d / "foo.test.ts").write_text("")
        assert not _denied(_run_tdd_guard(str(d / "foo.ts")))

    def test_allows_source_with_dunder_tests(self, work_dir):
        d = work_dir / "src" / "lib"
        (d / "__tests__").mkdir(parents=True)
        (d / "__tests__" / "foo.test.ts").write_text("")
        assert not _denied(_run_tdd_guard(str(d / "foo.ts")))

    @pytest.mark.parametrize("name", [
        "src/lib/foo.test.ts",
        "src/types/thumbnail.ts",
        "src/app/page.tsx",
        "src/app/layout.tsx",
        "package.json",
        "docs/README.md",
        "next.config.ts",
        "scripts/execute.py",
        "components/ScheduleGrid.tsx",
        "app/steps/ward.tsx",
        "lib/api.ts",
        "lib/supabase.ts",
    ])
    def test_allows_exempt_files(self, work_dir, name):
        assert not _denied(_run_tdd_guard(str(work_dir / name)))

    @pytest.mark.parametrize("name", [
        "lib/roster-import.ts",
        "lib/csv.ts",
        "lib/store.ts",
    ])
    def test_denies_lib_pure_functions_without_test(self, work_dir, name):
        assert _denied(_run_tdd_guard(str(work_dir / name)))

    def test_allows_missing_file_path(self):
        assert not _denied(_run_tdd_guard(""))
