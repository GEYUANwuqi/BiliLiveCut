# ruff: noqa: D100
from __future__ import annotations

import asyncio
import contextvars
import subprocess
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import partial
from typing import TypeVar

import psutil
from loguru import logger

from app.core.sanitize import safe_exception_summary

_T = TypeVar("_T")
_resources: contextvars.ContextVar[dict[object, Callable[[], None]] | None] = contextvars.ContextVar(
    "execution_resources", default=None
)


def retain_cleanup(cleanup: Callable[[], None]) -> Callable[[], None]:
    """将物理资源清理纳入当前执行，返回确认清理后的注销操作。"""
    resources = _resources.get()
    key = object()
    if resources is not None:
        resources[key] = cleanup

    def released() -> None:
        if resources is not None:
            resources.pop(key, None)

    return released


@contextmanager
def resource_scope() -> Iterator[None]:
    """清理未确认时保留执行占位，报告故障并重试专属资源的回收。"""
    # 每层独立收尾，避免内层任务先归还预算、外层才等待子进程。
    resources: dict[object, Callable[[], None]] = {}
    token = _resources.set(resources)
    try:
        yield
    finally:
        try:
            reported: dict[object, str] = {}
            while resources:
                for key, cleanup in tuple(resources.items()):
                    try:
                        cleanup()
                    except (OSError, RuntimeError, subprocess.SubprocessError, psutil.Error) as exc:
                        detail = safe_exception_summary(exc)
                        if reported.get(key) != detail:
                            logger.error("执行仍占用资源，等待物理清理确认: {}", detail)
                            reported[key] = detail
                    else:
                        resources.pop(key, None)
                        if key in reported:
                            logger.info("执行资源已确认清理，结束占位")
                if resources:
                    time.sleep(0.2)
        finally:
            _resources.reset(token)


def start_thread(operation: Callable[[], _T]) -> asyncio.Future[_T]:
    """创建不随 asyncio Task 取消而假装结束的同步执行句柄。"""
    context = contextvars.copy_context()

    def execute() -> _T:
        with resource_scope():
            return operation()

    return asyncio.get_running_loop().run_in_executor(None, context.run, execute)


async def wait_for_completion(future: asyncio.Future[_T], on_cancel: Callable[[], None] | None = None) -> bool:
    """等待物理执行完成；返回期间收到的取消意图，由调用者结算状态。"""
    cancelled = False
    while not future.done():
        # wait 只观察完成状态；业务异常由调用者通过 result/exception 原样读取。
        waiter = asyncio.create_task(asyncio.wait({future}))
        try:
            await asyncio.shield(waiter)
        except asyncio.CancelledError:
            if not cancelled and on_cancel is not None:
                on_cancel()
            cancelled = True
        finally:
            if not waiter.done():
                waiter.cancel()
                # 观察器不拥有 future，撤销它不会取消线程或改变物理退出判据。
    return cancelled


async def run_sync(operation: Callable[[], _T], cancel_result: Callable[[_T], None] | None = None) -> _T:
    """隔离同步操作；取消后等待真实返回，必要时撤回尚未使用的领取结果。"""
    future = start_thread(operation)
    cancelled = await wait_for_completion(future)
    result = future.result()
    if cancelled:
        if cancel_result is not None:
            await run_sync(partial(cancel_result, result))
        raise asyncio.CancelledError
    return result
