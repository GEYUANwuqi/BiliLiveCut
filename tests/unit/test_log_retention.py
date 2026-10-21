from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

import psutil
import pytest

from app.core.logging import _retain_file_logs

if TYPE_CHECKING:
    from pytest import CaptureFixture, MonkeyPatch


def _old_file(directory: Path, name: str) -> Path:
    path = directory / name
    path.write_text("retention fixture", encoding="utf-8")
    past = time.time() - 15 * 24 * 60 * 60
    os.utime(path, (past, past))
    return path


def test_retention_removes_expired_logs_but_preserves_live_and_unrelated_files(tmp_path: Path) -> None:
    exited = subprocess.Popen([sys.executable, "-c", "pass"])
    assert exited.wait(timeout=10) == 0
    assert not psutil.pid_exists(exited.pid)
    stem = f"blc-{exited.pid}-{'a' * 32}"
    expired = [
        _old_file(tmp_path, f"{stem}.log"),
        _old_file(tmp_path, f"{stem}.2026-01-01_12-00-00_123456.log.zip"),
        _old_file(tmp_path, f"{stem}.2026-01-01_12-00-00_123456.2.log.zip"),
        _old_file(tmp_path, f"blc-{os.getpid()}-{'b' * 32}.2026-01-01_12-00-00_123456.log.zip"),
    ]
    preserved = [
        _old_file(tmp_path, f"blc-{os.getpid()}-{'c' * 32}.log"),
        _old_file(tmp_path, "blc.log"),
        _old_file(tmp_path, "blc.2026-01-01_12-00-00_123456.log.zip"),
        _old_file(tmp_path, "blc-user-notes.log"),
    ]
    recent = _old_file(tmp_path, f"{stem}.2026-01-02_12-00-00_123456.log.zip")
    now = time.time()
    os.utime(recent, (now, now))
    preserved.append(recent)
    _retain_file_logs(tmp_path, [])
    assert all(not path.exists() for path in expired)
    assert all(path.exists() for path in preserved)


@pytest.mark.parametrize("failure", ["already_removed", "permission_denied"])
def test_retention_handles_cleanup_race_and_reports_denied_deletion(
    tmp_path: Path, monkeypatch: MonkeyPatch, capsys: CaptureFixture[str], failure: str
) -> None:
    path = _old_file(tmp_path, f"blc-{os.getpid()}-{'d' * 32}.2026-01-01_12-00-00_123456.log.zip")
    original = Path.unlink

    def failed_unlink(target: Path, missing_ok: bool = False) -> None:
        assert target == path
        if failure == "already_removed":
            original(target, missing_ok=missing_ok)
            raise FileNotFoundError(target)
        raise PermissionError("file locked token=private-retention-token")

    monkeypatch.setattr(Path, "unlink", failed_unlink)
    _retain_file_logs(tmp_path, [])
    diagnostic = capsys.readouterr().err
    if failure == "already_removed":
        assert not path.exists()
        assert diagnostic == ""
    else:
        assert path.exists()
        assert "PermissionError" in diagnostic and "已保留文件" in diagnostic
        assert "private-retention-token" not in diagnostic
