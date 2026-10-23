"""Logs."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlmodel import select

from app.db.entities import (
    SystemLog,
)
from app.db.session import get_session


def list_logs(
    limit: int = 100,
    level: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> list[dict[str, Any]]:
    """列出系统日志(WARNING 及以上写入了 system_logs)。

    :param limit: 数量上限。
    :param level: 可选级别过滤。
    :param start_at: 可选开始时间，包含边界；无时区时视为 UTC。
    :param end_at: 可选结束时间，不含边界；无时区时视为 UTC。
    :returns: 日志字典列表(按时间降序)。
    """
    start = _utc_naive(start_at) if start_at is not None else None
    end = _utc_naive(end_at) if end_at is not None else None
    if start is not None and end is not None and start >= end:
        raise ValueError("日志开始时间必须早于结束时间")
    with get_session() as db:
        stmt = select(SystemLog).order_by(SystemLog.created_at.desc(), SystemLog.id.desc())  # type: ignore[attr-defined]
        if level:
            stmt = stmt.where(SystemLog.level == level)
        if start is not None:
            stmt = stmt.where(SystemLog.created_at >= start)
        if end is not None:
            stmt = stmt.where(SystemLog.created_at < end)
        rows = db.exec(stmt.limit(max(1, min(limit, 500)))).all()
    return [
        {
            "id": x.id,
            "level": x.level,
            "module": x.module,
            "event": x.event,
            "message": x.message,
            "created_at": x.created_at.isoformat() if x.created_at else None,
        }
        for x in rows
    ]


def _utc_naive(value: datetime) -> datetime:
    """与数据库无时区的 UTC 日志时间比较，避免混用本地时间。"""
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo is not None else value


# --------------------------------------------------------------------------- #
# 录制预约(V0.1.2)
# --------------------------------------------------------------------------- #
