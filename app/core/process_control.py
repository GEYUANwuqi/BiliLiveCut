"""支持超时和协作取消的子进程执行工具。"""

from __future__ import annotations

import subprocess
import time
from collections.abc import Callable, Sequence
from typing import Any

from app.core.sanitize import safe_exception_summary


class ProcessCancelledError(RuntimeError):
    """外部命令因用户取消而终止。"""


def run_cancellable(
    command: Sequence[str],
    *,
    cancel_check: Callable[[], bool] | None = None,
    timeout: float | None = None,
    check: bool = False,
    capture_output: bool = False,
    text: bool = False,
    poll_interval_s: float = 0.2,
    **kwargs: Any,
) -> subprocess.CompletedProcess:
    """运行外部命令，并在取消或超时时终止子进程。"""
    if capture_output:
        if "stdout" in kwargs or "stderr" in kwargs:
            raise ValueError("capture_output 不能与 stdout/stderr 同时使用")
        kwargs["stdout"] = subprocess.PIPE
        kwargs["stderr"] = subprocess.PIPE
    process = subprocess.Popen(command, text=text, **kwargs)
    started = time.monotonic()
    stdout = stderr = None
    try:
        while True:
            if cancel_check is not None and cancel_check():
                raise ProcessCancelledError("用户取消了外部处理")
            if timeout is not None and time.monotonic() - started > timeout:
                stdout, stderr = _terminate(process)
                raise subprocess.TimeoutExpired(command, timeout, output=stdout, stderr=stderr)
            try:
                stdout, stderr = process.communicate(timeout=poll_interval_s)
                break
            except subprocess.TimeoutExpired:
                continue
    except BaseException as error:
        # 取消回调或管道读取本身异常也必须回收子进程。
        try:
            if process.poll() is None:
                _terminate(process)
        except (OSError, subprocess.SubprocessError) as cleanup_error:
            error.add_note(f"子进程清理失败: {safe_exception_summary(cleanup_error)}")
        raise
    result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    if check and result.returncode:
        raise subprocess.CalledProcessError(result.returncode, command, output=stdout, stderr=stderr)
    return result


def _terminate(process: subprocess.Popen) -> tuple[str | bytes | None, str | bytes | None]:
    """先优雅终止，超时后强制结束精确子进程。"""
    if process.poll() is None:
        try:
            process.terminate()
        except ProcessLookupError:
            pass  # 子进程在 poll 与 terminate 之间退出。
    try:
        return process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        return process.communicate(timeout=3)
