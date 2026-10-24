# ruff: noqa: D100
from __future__ import annotations

import threading
from contextlib import AbstractContextManager
from dataclasses import dataclass

from pydantic import JsonValue
from sqlmodel import Session

from app.db import job_store
from app.jobs.contracts import JobAttempt, JobCancelled


@dataclass(frozen=True, slots=True)
class JobContext:
    """领域执行的进度、协作取消和原子结果提交凭证。"""

    job_id: str
    _cancel_event: threading.Event
    attempt: int = 1

    @property
    def token(self) -> JobAttempt:
        """获取不可变执行代次。"""
        return JobAttempt(self.job_id, self.attempt)

    def report(self, progress: int, message: str) -> None:
        """记录当前代次的进度，迟到报告不能改写终态。"""
        self.check_cancelled()
        job_store.report(self.token, progress, message)

    def cancelled(self) -> bool:
        """返回当前执行是否收到停止信号。"""
        return self._cancel_event.is_set()

    def check_cancelled(self) -> None:
        """在计算边界响应停止信号。"""
        if self.cancelled():
            raise JobCancelled("用户取消了作业")

    def result_transaction(self) -> AbstractContextManager[Session]:
        """开启短写事务；正式业务结果与成功终态必须共同提交。"""
        self.check_cancelled()
        return job_store.result_transaction(self.token)

    def complete(self, db: Session, result: dict[str, JsonValue]) -> None:
        """由领域在同一事务内提交经过验证的结果引用。"""
        job_store.complete(db, self.token, result)
