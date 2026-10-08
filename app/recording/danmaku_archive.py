"""Append-only per-session archives, separate from sampled analysis records."""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Literal

from loguru import logger

from app.core.config import settings
from app.plugins.live_source import SourceRoom


def archive_path(session_id: int) -> Path:
    """Resolve the fixed archive path without creating directories or escaping storage."""
    if session_id <= 0:
        raise ValueError("场次编号必须为正整数")
    root = Path(settings.storage_root).expanduser().resolve()
    expected = root / "raw" / f"session_{session_id}" / "danmaku.jsonl"
    path = expected.resolve()
    if path != expected:
        raise ValueError("弹幕档案路径不能重定向到其他位置")
    return path


def archive_view(session_id: int) -> dict[str, object]:
    """Report archive availability without creating files or exposing local paths."""
    try:
        path = archive_path(session_id)
        return {"available": path.is_file()}
    except (OSError, ValueError):
        return {"available": False}


class DanmakuArchive:
    """Flush complete JSONL records without changing database sampling semantics."""

    def __init__(self, session_id: int, room: SourceRoom) -> None:
        self.session_id = session_id
        self.room = room
        self.error: str | None = None
        self._lock = threading.Lock()
        self._started = False

    def start(self) -> None:
        """Create an identifiable empty-session archive, preserving existing contents."""
        with self._lock:
            if self._started or self.error:
                return
            self._write([self._record("session", {})])
            self._started = True

    def append(self, payloads: list[dict[str, object]], *, event_format: Literal["raw", "normalized"]) -> None:
        """Persist received messages before sampling; file failure leaves capture running."""
        with self._lock:
            if self.error or not payloads:
                return
            records = [] if self._started else [self._record("session", {})]
            records.extend(self._record(event_format, payload) for payload in payloads)
            self._write(records)
            self._started = True

    def _record(self, kind: str, payload: dict[str, object]) -> dict[str, object]:
        return {
            "version": 1,
            "kind": kind,
            "session_id": self.session_id,
            "platform": self.room.platform,
            "source_id": self.room.source_id,
            "received_at": datetime.now(UTC).isoformat(),
            "payload": payload,
        }

    def _write(self, records: list[dict[str, object]]) -> None:
        try:
            path = archive_path(self.session_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            data = "".join(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n" for record in records)
            # 每批关闭文件即刷新用户态缓存；完整旧行在中断后仍可独立读取。
            with path.open("ab") as stream:
                stream.write(data.encode("utf-8"))
        except (OSError, ValueError, TypeError) as exc:
            self.error = f"弹幕原始档写入失败（{type(exc).__name__}），本场已停止写档；数据库采集继续。"
            # 原始消息可能含用户数据及签名链接，不让 diagnose 展开局部变量。
            logger.error(
                "danmaku_archive_failed: session={} raw/session_{}/danmaku.jsonl error={}",
                self.session_id,
                self.session_id,
                type(exc).__name__,
            )


def open_archive_snapshot(session_id: int) -> tuple[BinaryIO, int]:
    """Open a bounded snapshot ending at a complete JSONL line during live append."""
    stream = archive_path(session_id).open("rb")
    try:
        stream.seek(0, 2)
        boundary = stream.tell()
        while boundary:
            start = max(0, boundary - 65536)
            stream.seek(start)
            tail = stream.read(boundary - start)
            newline = tail.rfind(b"\n")
            if newline >= 0:
                boundary = start + newline + 1
                break
            boundary = start
        stream.seek(0)
        return stream, boundary
    except OSError:
        stream.close()
        raise
