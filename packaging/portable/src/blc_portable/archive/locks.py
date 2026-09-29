"""跨进程文件锁 — Runtime 和 Engine Pack 安装共用。"""

from __future__ import annotations

import contextlib
import errno
import os
import time
from collections.abc import Generator
from pathlib import Path


class FileLock:
    """基于文件的跨进程排他锁。

    用法:
        lock = FileLock("/path/to/.lock")
        with lock.acquire(timeout=60):
            ...
    """

    def __init__(self, lock_path: Path) -> None:
        self._lock_path = lock_path
        self._fd: int | None = None

    @contextlib.contextmanager
    def acquire(self, timeout: float = 120.0) -> Generator[None, None, None]:
        """获取排他锁。

        :param timeout: 最长等待秒数 (0 表示不等待)。
        :yields: 成功获取锁后继续。
        :raises TimeoutError: 超时未获取锁。
        """
        if self._fd is not None:
            raise RuntimeError("FileLock 不支持重入")
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + max(0.0, timeout)
        fd = os.open(str(self._lock_path), os.O_CREAT | os.O_RDWR, 0o600)
        acquired = False
        try:
            # Windows 可锁定 EOF 之后的字节，无须改写其它持有者的锁文件。
            while True:
                try:
                    os.lseek(fd, 0, os.SEEK_SET)
                    if os.name == "nt":
                        import msvcrt

                        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    self._fd = fd
                    break
                except OSError as exc:
                    if exc.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                        raise
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError(f"无法获取锁: {self._lock_path} (超时 {timeout}s)") from exc
                    time.sleep(min(0.1, remaining))
            yield
        finally:
            try:
                if acquired:
                    os.lseek(fd, 0, os.SEEK_SET)
                    if os.name == "nt":
                        import msvcrt

                        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)
                self._fd = None
            # 路径永久保留，避免删除后等待者与新进程分别锁定不同 inode。


def get_runtime_lock_path(app_root: Path) -> Path:
    """获取 Runtime 安装锁路径。

    :param app_root: 应用根目录。
    :returns: 锁文件路径。
    """
    return app_root / "runtime" / ".runtime-install.lock"


def get_engine_pack_lock_path(app_root: Path) -> Path:
    """获取 Engine Pack 安装锁路径。

    :param app_root: 应用根目录。
    :returns: 锁文件路径。
    """
    return app_root / "runtime" / ".engine-pack-install.lock"
