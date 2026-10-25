# ruff: noqa: D100
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from loguru import logger


@dataclass(frozen=True)
class Service:
    """组合入口提供的生命周期接口；监管器不读取业务表或调用领域逻辑。"""

    name: str
    start: Callable[[], Awaitable[object]] | None = None
    stop: Callable[[], Awaitable[object]] | None = None


class Supervisor:
    """顺序启动服务，先通知停止接单，再逆序清理所有已登记服务。"""

    def __init__(self, services: Sequence[Service], request_stop: Callable[[], None]) -> None:
        if len({service.name for service in services}) != len(services):
            raise ValueError("受监管服务名称必须唯一")
        self._services = tuple(services)
        self._request_stop = request_stop
        self._active = False
        self._failed = False

    async def _stop(self, service: Service) -> None:
        assert service.stop is not None
        try:
            await service.stop()
        except BaseException:
            # 关闭边界必须记录失败，同时由退出栈继续清理其余服务。
            self._failed = True
            logger.exception("应用服务关闭失败 service={}", service.name)
            raise

    @asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        """登记清理先于启动，覆盖部分启动失败及应用作用域取消。"""
        if self._active or self._failed:
            raise RuntimeError("应用服务仍在运行或此前关闭未完成，不能重复启动")
        self._active = True
        try:
            async with AsyncExitStack() as cleanup:
                try:
                    for service in self._services:
                        if service.stop is not None:
                            cleanup.push_async_callback(self._stop, service)
                        if service.start is not None:
                            await service.start()
                    yield
                finally:
                    self._request_stop()
        finally:
            self._active = False
