from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from zipfile import ZipFile

import psutil


def _wait_for_workers(directory: Path, suffix: str, processes: list[subprocess.Popen[bytes]]) -> None:
    deadline = time.monotonic() + 30
    while not all((directory / f"{name}.{suffix}").exists() for name in ("first", "second")):
        if any(process.poll() is not None for process in processes) or time.monotonic() >= deadline:
            logs = [path.read_text(encoding="utf-8") for path in directory.glob("*.stderr")]
            raise AssertionError(f"日志进程未完成 {suffix}: {logs}")
        time.sleep(0.02)


def test_independent_processes_rotate_without_losing_or_duplicating_records(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[2]
    directory = tmp_path / "storage" / "logs"
    directory.mkdir(parents=True)
    legacy = directory / "blc.log"
    legacy.write_text("legacy log must be preserved\n", encoding="utf-8")
    env = {
        **os.environ,
        "PYTHONPATH": str(root),
        "BLC_APP_ROOT": str(tmp_path),
        "STORAGE_ROOT": str(tmp_path / "storage"),
        "DATABASE_URL": f"sqlite:///{tmp_path / 'test.db'}",
        "LOG_LEVEL": "ERROR",
        "PYTHONUTF8": "1",
    }
    processes: list[subprocess.Popen[bytes]] = []
    with ExitStack() as stack:
        try:
            for name in ("first", "second"):
                output = stack.enter_context((tmp_path / f"{name}.stderr").open("wb"))
                processes.append(
                    subprocess.Popen(
                        [sys.executable, str(Path(__file__).with_name("logging_worker.py")), str(tmp_path), name],
                        cwd=tmp_path,
                        env=env,
                        stdout=output,
                        stderr=output,
                    )
                )
            _wait_for_workers(tmp_path, "ready", processes)
            (tmp_path / "start").touch()
            _wait_for_workers(tmp_path, "done", processes)
            (tmp_path / "finish").touch()
            for process in processes:
                assert process.wait(timeout=10) == 0
        finally:
            for process in processes:
                if process.poll() is None:
                    descendants = psutil.Process(process.pid).children(recursive=True)
                    for child in reversed(descendants):
                        try:
                            child.kill()
                        except psutil.NoSuchProcess:
                            pass
                    process.kill()
                    process.wait(timeout=5)

    assert legacy.read_text(encoding="utf-8") == "legacy log must be preserved\n"
    for name in ("first", "second"):
        assert (tmp_path / f"{name}.stderr").read_text(encoding="utf-8") == ""
        worker = json.loads((tmp_path / f"{name}.ready").read_text(encoding="utf-8"))
        paths = list(directory.glob(f"blc-{worker['pid']}-*.log*"))
        assert any(path.suffix == ".zip" for path in paths), "必须真实触发默认 10 MB 轮转与压缩"
        assert any(path.suffix == ".log" for path in paths)
        parts = []
        for path in paths:
            if path.suffix == ".zip":
                with ZipFile(path) as archive:
                    assert archive.testzip() is None
                    parts.extend(archive.read(member).decode("utf-8") for member in archive.namelist())
            else:
                parts.append(path.read_text(encoding="utf-8"))
        text = "".join(parts)
        records = re.findall(rf"rotation-record:{name}:([0-9]{{4}})", text)
        assert sorted(records) == [f"{index:04d}" for index in range(700)]
        assert text.count(f"rotation-start:{name}") == text.count(f"rotation-end:{name}") == 1
        assert "private-rotation-token" not in text
