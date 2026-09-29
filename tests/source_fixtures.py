"""显式构造当前来源身份与弹幕证据，避免测试依赖历史格式。"""

from datetime import UTC, datetime

from sqlmodel import Session

from app.db.entities import AppSetting, LiveRoom
from app.plugins.live_source import DanmakuStatus, SourceRoom
from app.recording.danmaku import CaptureInterval, DanmakuEvidence
from app.sources.rooms import SourceBinding, _identity_key


def bind_bilibili_room(db: Session, room: LiveRoom) -> None:
    """为已落库的 Bilibili 测试房间保存完整双向绑定。"""
    assert room.id is not None and room.room_id is not None and room.platform == "bilibili"
    source = SourceRoom(
        platform="bilibili",
        source_id=str(room.room_id),
        canonical_url=f"https://live.bilibili.com/{room.room_id}",
    )
    binding = SourceBinding(room_db_id=room.id, room=source)
    for key in (_identity_key(source), f"source_room:{room.id}"):
        db.add(AppSetting(key=key, value=binding.model_dump_json()))


def add_danmaku_evidence(db: Session, session_id: int, start: datetime, end: datetime, lag_s: float = 7.5) -> None:
    """保存指定时间窗的有效连接记录，零条弹幕仍有明确覆盖语义。"""
    start = start.replace(tzinfo=UTC) if start.tzinfo is None else start
    end = end.replace(tzinfo=UTC) if end.tzinfo is None else end
    evidence = DanmakuEvidence(
        status=DanmakuStatus.AVAILABLE,
        lag_s=lag_s,
        intervals=[CaptureInterval(start=start, end=end)],
        ended_at=end,
        confirmed_until=end,
    )
    db.add(AppSetting(key=f"session_danmaku:{session_id}", value=evidence.model_dump_json()))
