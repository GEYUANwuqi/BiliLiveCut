from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from blc_portable.launcher import progress


@pytest.mark.parametrize("mode", ["serialize", "write"])
def test_sdk_finalizer_can_emit_during_progress_without_deadlock_or_partial_events(tmp_path: Path, mode: str) -> None:
    result = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("progress_gc_worker.py")), mode],
        cwd=tmp_path,
        env={
            **os.environ,
            "PYTHONPATH": str(Path(progress.__file__).resolve().parents[2]),
            "BLC_MODEL_PROGRESS": "1",
            "PYTHONUTF8": "1",
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
        check=True,
    )
    assert result.stderr == ""
    states = json.loads(result.stdout)
    assert len(states) == 404
    orphan = [state["completed"] for state in states if state["label"] == "gc-orphan"]
    assert orphan == [0, 3, 3]
    assert sum(state["label"] == "outer" for state in states) == 1
    for worker in range(4):
        assert [state["completed"] for state in states if state["label"] == f"worker-{worker}"] == list(range(100))
