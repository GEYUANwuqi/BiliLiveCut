# ruff: noqa: D100
from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass, field
from threading import RLock
from typing import Literal
from uuid import uuid4

Topic = Literal["state", "review", "jobs"]
Role = Literal["admin", "reviewer"]


@dataclass(frozen=True, slots=True)
class Change:
    """提交后的查询失效提示，不携带业务值、路径或凭据。"""

    topic: Topic
    owner: str = ""


@dataclass(frozen=True, slots=True)
class Notice:
    """仅属于一个身份范围的有界通知游标。"""

    cursor: str
    kind: Literal["invalidate", "resync"]
    topics: tuple[Topic, ...] = ()


@dataclass(slots=True)
class _History:
    """一个授权身份范围内的内存历史。"""

    epoch: str = field(default_factory=lambda: uuid4().hex)
    sequence: int = 0
    readers: int = 0
    events: deque[Notice] = field(default_factory=deque)

    @property
    def cursor(self) -> str:
        """返回该身份的当前通知位置。"""
        return f"{self.epoch}:{self.sequence}"


class SubscriptionLimit(RuntimeError):
    """当前通知连接已达到上限，调用者应退避并保留 HTTP 查询。"""


class Subscription:
    """连接独占的登记；关闭可重复调用，不会释放其他连接。"""

    def __init__(self, bus: NotificationBus, key: tuple[Role, str]) -> None:
        self._bus = bus
        self._key = key
        self._closed = False

    def read(self, cursor: str) -> tuple[Notice, ...]:
        """读取身份范围内的通知；游标过期或来自其他身份时要求 HTTP 恢复。"""
        with self._bus._lock:
            if self._closed:
                raise RuntimeError("通知连接已经关闭")
            history = self._bus._histories[self._key]
            if cursor == history.cursor:
                return ()
            for index, event in enumerate(history.events):
                if event.cursor == cursor:
                    return tuple(history.events)[index + 1 :]
            return (Notice(history.cursor, "resync"),)

    def resync(self) -> Notice:
        """定期核对跨进程或非 ORM 写入，定时器不依赖其他账号的活动。"""
        with self._bus._lock:
            if self._closed:
                raise RuntimeError("通知连接已经关闭")
            return Notice(self._bus._histories[self._key].cursor, "resync")

    def close(self) -> None:
        """归还本连接登记，保留有界历史供短时重连。"""
        with self._bus._lock:
            if not self._closed:
                self._closed = True
                self._bus._histories[self._key].readers -= 1


class NotificationBus:
    """线程安全的通知投影；内存、身份数量和活跃连接均有上限。"""

    def __init__(self, *, capacity: int = 128, scopes: int = 64, readers: int = 64, per_owner: int = 4) -> None:
        if min(capacity, scopes, readers, per_owner) < 1:
            raise ValueError("通知容量必须为正整数")
        self._capacity, self._scopes, self._readers, self._per_owner = capacity, scopes, readers, per_owner
        self._lock = RLock()
        self._histories: OrderedDict[tuple[Role, str], _History] = OrderedDict()

    def subscribe(self, role: Role, owner: str) -> Subscription:
        """只登记已经认证的身份，不接受匿名或未知角色。"""
        if role not in {"admin", "reviewer"} or not owner or len(owner) > 128:
            raise ValueError("无效的通知身份")
        key = role, owner
        with self._lock:
            history = self._histories.get(key)
            if sum(item.readers for item in self._histories.values()) >= self._readers or (
                history is not None and history.readers >= self._per_owner
            ):
                raise SubscriptionLimit("通知连接过多，请关闭多余页面后重试")
            if history is None:
                if len(self._histories) >= self._scopes:
                    idle = next((key for key, item in self._histories.items() if item.readers == 0), None)
                    if idle is None:
                        raise SubscriptionLimit("通知身份容量已满，请稍后重试")
                    del self._histories[idle]
                history = self._histories[key] = _History()
                history.events.append(Notice(history.cursor, "resync"))
            self._histories.move_to_end(key)
            history.readers += 1
        return Subscription(self, key)

    def publish(self, changes: set[Change]) -> None:
        """将一笔成功事务聚合为每个可见身份至多一条通知。"""
        with self._lock:
            for (role, owner), history in self._histories.items():
                topics = tuple(
                    sorted(
                        {
                            item.topic
                            for item in changes
                            if role == "admin"
                            or item.topic == "review"
                            or (item.topic == "jobs" and item.owner == owner)
                        }
                    )
                )
                if not topics:
                    continue
                history.sequence += 1
                history.events.append(Notice(history.cursor, "invalidate", topics))
                while len(history.events) > self._capacity:
                    history.events.popleft()


notifications = NotificationBus()
