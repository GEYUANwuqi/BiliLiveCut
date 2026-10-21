"""直播消息的类型边界；协议字段解析与采样、归档、数据库策略分离。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class _MessageModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, allow_inf_nan=False)


class UserInfo(_MessageModel):
    """消息发送者；附加资料缺失不影响正文解析。"""

    uid: int | None = Field(default=None, ge=0)
    name: str | None = None
    level: int | None = Field(default=None, ge=0)
    face: str | None = None


class MedalInfo(_MessageModel):
    """普通弹幕携带的粉丝牌。"""

    level: int = Field(ge=0)
    name: str
    anchor_name: str | None = None
    room_id: int | None = Field(default=None, ge=0)
    is_light: int | None = None
    anchor_uid: int | None = Field(default=None, ge=0)


class DanmakuMessage(_MessageModel):
    """位置数组形式的普通弹幕。"""

    command: Literal["DANMU_MSG"] = "DANMU_MSG"
    content: str = Field(strict=True)
    user: UserInfo
    medal: MedalInfo | None = None
    sent_at: float | None = None


class GiftMessage(_MessageModel):
    """礼物金额保留上游单位，持久化适配器继续采用原有热度折算。"""

    command: Literal["SEND_GIFT"] = "SEND_GIFT"
    uid: int | None = Field(default=None, ge=0)
    user_name: str | None = Field(default=None, validation_alias="uname")
    gift_id: int | None = Field(default=None, validation_alias="giftId", ge=0)
    gift_name: str | None = Field(default=None, validation_alias="giftName")
    count: int = Field(default=1, validation_alias="num", ge=0)
    total_coin: float = Field(default=0, ge=0)
    coin_type: str | None = None


class SuperChatMessage(_MessageModel):
    """醒目留言及其单独的价格单位。"""

    command: Literal["SUPER_CHAT_MESSAGE"] = "SUPER_CHAT_MESSAGE"
    message: str | None = None
    user_info: UserInfo = Field(default_factory=UserInfo)
    price: float = Field(default=0, ge=0)


class InteractionMessage(_MessageModel):
    """进场互动，保留消息子类型供调用方判断。"""

    command: Literal["INTERACT_WORD"] = "INTERACT_WORD"
    uid: int | None = Field(default=None, ge=0)
    user_name: str | None = Field(default=None, validation_alias="uname")
    msg_type: int | None = None


class GuardMessage(_MessageModel):
    """上舰消息的结构化视图；不因此新增数据库保留类型。"""

    command: Literal["GUARD_BUY"] = "GUARD_BUY"
    uid: int | None = Field(default=None, ge=0)
    username: str | None = None
    guard_level: int | None = Field(default=None, ge=1, le=3)
    num: int = Field(default=1, ge=0)
    price: float = Field(default=0, ge=0)
    gift_name: str | None = None


class LiveMessage(_MessageModel):
    """带有效开播时间的 LIVE 才是新开播通知。"""

    command: Literal["LIVE"] = "LIVE"
    room_id: int | None = Field(default=None, validation_alias="roomid", gt=0)
    live_time: int = Field(default=0, ge=0)

    @field_validator("live_time", mode="before")
    @classmethod
    def reject_boolean_time(cls, value: object) -> object:
        """布尔值不能因为可转换为整数而伪装成开播时间。"""
        if isinstance(value, bool):
            raise ValueError("live_time 必须是时间戳")
        return value


class PreparingMessage(_MessageModel):
    """下播或进入轮播；房间号可能是字符串短号。"""

    command: Literal["PREPARING"] = "PREPARING"
    room_id: int | None = Field(default=None, validation_alias="roomid", gt=0)


BilibiliMessage = (
    DanmakuMessage | GiftMessage | SuperChatMessage | InteractionMessage | GuardMessage | LiveMessage | PreparingMessage
)
_PAYLOAD_MODELS: dict[str, type[_MessageModel]] = {
    "SEND_GIFT": GiftMessage,
    "SUPER_CHAT_MESSAGE": SuperChatMessage,
    "INTERACT_WORD": InteractionMessage,
    "GUARD_BUY": GuardMessage,
}


def _at(value: object, *indices: int | str) -> Any:
    for index in indices:
        if isinstance(index, int) and isinstance(value, (list, tuple)) and 0 <= index < len(value):
            value = value[index]
        elif isinstance(index, str) and isinstance(value, dict):
            value = value.get(index)
        else:
            return None
    return value


def _user(name: object, **fields: object) -> UserInfo:
    name = name if isinstance(name, str) else None
    try:
        return UserInfo.model_validate({"name": name, **fields})
    except ValidationError:
        return UserInfo(name=name)


def parse_stream_message(raw: object) -> BilibiliMessage | None:
    """从原始字典或事件回调信封解析，不修改原始数据；坏消息只丢弃自身。"""
    if not isinstance(raw, dict):
        return None
    if "cmd" not in raw and isinstance(raw.get("data"), dict):
        raw = raw["data"]
    command = raw.get("cmd")
    if not isinstance(command, str):
        return None
    command = command.split(":", 1)[0]
    try:
        if command == "DANMU_MSG":
            info = raw.get("info")
            user = _user(
                _at(info, 2, 1),
                uid=_at(info, 2, 0),
                level=_at(info, 4, 0),
                face=_at(info, 0, 15, "user", "base", "face"),
            )
            medal = None
            if _at(info, 3, 0) is not None:
                try:
                    medal = MedalInfo.model_validate(
                        dict(zip(("level", "name", "anchor_name", "room_id"), _at(info, 3)[:4], strict=False))
                        | {"is_light": _at(info, 3, 11), "anchor_uid": _at(info, 3, 12)}
                    )
                except ValidationError:
                    pass
            timestamp = _at(info, 9, "ts")
            if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
                timestamp = None
            return DanmakuMessage(content=_at(info, 1), user=user, medal=medal, sent_at=timestamp)
        if command in {"LIVE", "PREPARING"}:
            # 上游原始消息把状态字段放在根；部分事件回调会多包一层 data。
            payload = raw.get("data") if isinstance(raw.get("data"), dict) else raw
            model = LiveMessage if command == "LIVE" else PreparingMessage
            return model.model_validate(payload)
        model = _PAYLOAD_MODELS.get(command)
        if model is None:
            return None
        payload = raw.get("data")
        if not isinstance(payload, dict):
            return None
        if command == "SUPER_CHAT_MESSAGE":
            user = payload.get("user_info")
            payload = {**payload, "user_info": _user(_at(user, "uname"), uid=payload.get("uid"))}
        return model.model_validate(payload)
    except (ValidationError, TypeError, ValueError, OverflowError):
        return None
