"""显式构造当前来源身份与弹幕证据，避免测试依赖历史格式。"""

import asyncio
from datetime import UTC, datetime

from sqlmodel import Session

from app.db.entities import AppSetting, LiveRoom
from app.plugins.live_source import DanmakuStateSink, DanmakuStatus, LiveStateSink, LiveStatus, RoomSnapshot, SourceRoom
from app.recording.danmaku import CaptureInterval, DanmakuEvidence
from app.sources.rooms import SourceBinding, _identity_key


class LiveEventFeed:
    """受控的开下播传输边界，不替换真实监控、补查和自动录制逻辑。"""

    def __init__(self) -> None:
        self.connected = asyncio.Event()
        self.closed = asyncio.Event()
        self.queue: asyncio.Queue[LiveStatus | DanmakuStatus] = asyncio.Queue()

    async def collect(self, room: SourceRoom, emit: LiveStateSink, state: DanmakuStateSink) -> None:
        """连接后由宿主进行初始补查，之后只有显式事件触发变化。"""
        try:
            await state(DanmakuStatus.AVAILABLE)
            self.connected.set()
            while True:
                value = await self.queue.get()
                try:
                    if isinstance(value, LiveStatus):
                        await emit(RoomSnapshot(status=value))
                    else:
                        await state(value)
                finally:
                    self.queue.task_done()
        finally:
            self.closed.set()

    async def send(self, value: LiveStatus | DanmakuStatus) -> None:
        """等待事件处理完成，不用固定 sleep 猜测后台时序。"""
        await self.queue.put(value)
        await asyncio.wait_for(self.queue.join(), 3)

    async def ready(self, monitor: object, room_id: int) -> None:
        """等待连接以及该连接的初始状态补查完成。"""
        await asyncio.wait_for(self.connected.wait(), 3)
        task = monitor._subscriptions[room_id].snapshot_task
        await asyncio.wait_for(task, 3)


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
