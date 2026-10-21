"""弹幕分级采样。

按弹幕类型、价值分层对弹幕进行采样, 在高频直播中限制入库量防止数据库膨胀。

采样策略:
- DANMAKU (普通弹幕): 保留率 30% (高频可适当丢弃)
- SUPER_CHAT (SC / 醒目留言): 保留率 100% (高价值互动)
- INTERACT (进场等互动): 保留率 100%
- GIFT (礼物): 保留率 80%
- OTHER: 保留率 50%

每房间维护滑动窗口缓冲区, 按窗口内密度动态调整丢弃率:
- 窗口内弹幕数 > 1000/分钟 → 普通弹幕保留率降至 10%
上述默认值可按房间覆盖；原始档不受采样影响。上舰等未映射消息不进入此入库采样路径。
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict, Field

from app.db.entities import DanmakuType


class DanmakuSamplingPolicy(BaseModel):
    """房间独立的入库采样规则，保留率使用 0～1、精度为 1%。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    danmaku_rate: float = Field(default=0.30, ge=0, le=1, multiple_of=0.01, strict=True, allow_inf_nan=False)
    gift_rate: float = Field(default=0.80, ge=0, le=1, multiple_of=0.01, strict=True, allow_inf_nan=False)
    superchat_rate: float = Field(default=1.0, ge=0, le=1, multiple_of=0.01, strict=True, allow_inf_nan=False)
    interact_rate: float = Field(default=1.0, ge=0, le=1, multiple_of=0.01, strict=True, allow_inf_nan=False)
    high_density_enabled: bool = Field(default=True, strict=True)
    high_density_threshold: int = Field(default=1000, ge=1, le=1_000_000, strict=True)
    high_density_rate: float = Field(default=0.10, ge=0, le=1, multiple_of=0.01, strict=True, allow_inf_nan=False)


def session_sampling_policy(session_id: int) -> DanmakuSamplingPolicy:
    """从录制场次关联宿主房间，不能用平台房间号代替数据库主键。"""
    from app.analysis.room_config import load_room_config
    from app.db.entities import LiveRoom, RecordingSession
    from app.db.session import get_session

    with get_session() as db:
        session = db.get(RecordingSession, session_id)
        if session is None or (room := db.get(LiveRoom, session.room_id)) is None:
            raise ValueError("弹幕采样场次或所属直播间不存在")
        return DanmakuSamplingPolicy.model_validate(load_room_config(room)["danmaku_sampling"])


_RATE_FIELDS = {
    DanmakuType.DANMAKU: "danmaku_rate",
    DanmakuType.GIFT: "gift_rate",
    DanmakuType.SUPERCHAT: "superchat_rate",
    DanmakuType.INTERACT: "interact_rate",
}


@dataclass
class DanmakuSampler:
    """弹幕分级采样器。

    维护一个滑动窗口 (默认 60 秒), 根据窗口内弹幕密度动态调整采样率。

    :param window_s: 采样窗口长度 (秒)。
    """

    window_s: float = 60.0
    policy: DanmakuSamplingPolicy = field(default_factory=DanmakuSamplingPolicy)
    _timestamps: deque[float] = field(default_factory=deque)
    _seq: int = 0  # 确定性 hash seed 序列号

    def should_keep(self, dm_type: DanmakuType) -> bool:
        """判断一条弹幕是否应被保留入库。

        :param dm_type: 弹幕类型。
        :returns: True 表示保留。
        """
        # 确定性 hash (基于序列号, 避免 random 的不可复现)
        self._seq += 1
        # 简单分桶: 用 seq % 100 作为 0-99 的均匀分布
        bucket = (self._seq * 2654435761) % 100  # Knuth multiplicative hash
        rate = self._effective_rate(dm_type)
        return bucket < round(rate * 100)

    def _effective_rate(self, dm_type: DanmakuType) -> float:
        """根据当前窗口密度计算实际保留率。

        :param dm_type: 弹幕类型。
        :returns: 实际保留率 (0.0-1.0)。
        """
        field_name = _RATE_FIELDS.get(dm_type)
        base = getattr(self.policy, field_name) if field_name else 0.50
        if dm_type != DanmakuType.DANMAKU:
            return base
        # 仅普通弹幕受密度影响
        density = self._density_per_minute()
        if self.policy.high_density_enabled and density > self.policy.high_density_threshold:
            return self.policy.high_density_rate
        return base

    def record(self) -> None:
        """记录一条弹幕进入窗口 (无论最终是否入库)。"""
        now = time.time()
        self._timestamps.append(now)
        self._prune()

    def _density_per_minute(self) -> float:
        """计算滑动窗口内每分钟弹幕数。

        :returns: 每分钟弹幕数。
        """
        self._prune()
        if not self._timestamps:
            return 0.0
        elapsed = max(self._timestamps[-1] - self._timestamps[0], 1.0)
        return len(self._timestamps) / elapsed * 60

    def _prune(self) -> None:
        """丢弃窗口外的旧时间戳。"""
        cutoff = time.time() - self.window_s
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()


# 按房间维护采样器实例
_room_samplers: dict[int, DanmakuSampler] = {}


def get_sampler(room_id: int) -> DanmakuSampler:
    """获取或创建房间级弹幕采样器。

    :param room_id: Bilibili 房间号。
    :returns: 该房间的 :class:`DanmakuSampler` 实例。
    """
    if room_id not in _room_samplers:
        _room_samplers[room_id] = DanmakuSampler()
    return _room_samplers[room_id]
