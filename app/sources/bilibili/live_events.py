"""只消费开下播控制消息的连接，不建立录制会话、不保存弹幕。"""

from __future__ import annotations

from app.plugins.live_source import DanmakuStateSink, LiveStateSink, LiveStatus, RoomSnapshot
from app.sources.bilibili.danmaku import OP_MESSAGE, DanmakuConnection, decode
from app.sources.bilibili.messages import LiveMessage, PreparingMessage, parse_stream_message


class BilibiliLiveEvents(DanmakuConnection):
    """复用登录回退、候选节点、鉴权、心跳和重连，不复用持久化操作。"""

    def __init__(self, room_id: int, cookie: str, emit: LiveStateSink, state: DanmakuStateSink) -> None:
        super().__init__(room_id, cookie, on_state=state)
        self._emit = emit

    async def _process_frame(self, frame: bytes) -> None:
        """只把真实开播和准备/轮播通知送往自动录制监控。"""
        for operation, raw in decode(frame):
            if operation != OP_MESSAGE or not isinstance(raw, dict):
                continue
            if raw.get("cmd") not in {"LIVE", "PREPARING"}:
                continue
            message = parse_stream_message(raw)
            if isinstance(message, LiveMessage) and message.live_time > 0:
                await self._emit(RoomSnapshot(status=LiveStatus.LIVE))
            elif isinstance(message, PreparingMessage):
                await self._emit(RoomSnapshot(status=LiveStatus.OFFLINE))
