from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def test_invalid_parent_pipe_reports_failure_after_lifespan_cleanup(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[2]
    env = {
        **os.environ,
        "PYTHONPATH": str(root),
        "PYTHONIOENCODING": "utf-8",
        "BLC_APP_ROOT": str(tmp_path),
        "STORAGE_ROOT": str(tmp_path / "storage"),
        "DATABASE_URL": f"sqlite:///{tmp_path / 'test.db'}",
        "ADMIN_PASSWORD": "",
        "DOCKER_AUTH_ENABLED": "false",
        "BILIBILI_COOKIE": "",
        "ASR_NO_MODEL_DOWNLOAD": "1",
        "TREND_ENABLED": "false",
        "TREND_SCHEDULE_ENABLED": "false",
        "_BLC_PARENT_STDIN": "1",
    }
    # 真实关闭标准输入，后端启动、生命周期和管道监管均走正式实现。
    script = (
        "import runpy, socket, sys; "
        "probe = socket.socket(); probe.bind(('127.0.0.1', 0)); "
        "port = probe.getsockname()[1]; probe.close(); "
        "sys.stdin.close(); "
        "sys.argv = ['blc', 'backend', '--port', str(port)]; "
        "runpy.run_module('app.cli', run_name='__main__', alter_sys=True)"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        encoding="utf-8",
        timeout=45,
    )
    assert result.returncode == 1, result.stdout
    assert "父进程监管管道异常" in result.stdout
    assert "ValueError" in result.stdout
    assert "Web 服务资源已关闭" in result.stdout
