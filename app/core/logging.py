"""日志系统。

基于 loguru 提供结构化、带轮转的日志:

* 控制台彩色输出(便于开发);
* 文件输出到 ``storage/logs/blc.log``,自动轮转与压缩(便于排错追溯);
* 通过 :func:`setup_logging` 在程序入口初始化一次。

业务模块直接 ``from loguru import logger`` 使用即可。
"""

from __future__ import annotations

import logging
import sys
import traceback
from typing import TYPE_CHECKING

from loguru import logger

from app.core.config import settings
from app.core.paths import logs_dir
from app.core.sanitize import safe_exception_summary, sanitize_diagnostic

if TYPE_CHECKING:
    from loguru import Message, Record

_CONFIGURED = False


class _ApplicationLogHandler(logging.Handler):
    """将流水线使用的标准 logging 接入同一文件和数据库诊断通道。"""

    def emit(self, record: logging.LogRecord) -> None:
        if record.name == "uvicorn.access" and isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, path, protocol, status = record.args
            record.args = (client, method, str(path).split("?", 1)[0], protocol, status)
        message = sanitize_diagnostic(record.getMessage(), limit=32768)
        logger.bind(_stdlib_origin=(record.name, record.funcName, record.lineno)).opt(exception=record.exc_info).log(
            record.levelname, "{}", message
        )
        if record.exc_info and record.exc_info[1]:
            message += "\n" + safe_exception_summary(record.exc_info[1])
        # 后续已有标准处理器（包括控制台）也不能重新输出原始异常/参数。
        record.msg, record.args, record.exc_info, record.exc_text = message, (), None, None


def _safe_record(record: Record) -> None:
    """在所有 sink 之前保留安全上下文和异常链；不渲染局部变量或命令参数。"""
    context = record["extra"]
    if context.get("_diagnostic_formatted"):
        return
    context["_diagnostic_formatted"] = True
    origin = context.pop("_stdlib_origin", None)
    if origin is not None:
        record["name"], record["function"], record["line"] = origin
    message = record["message"]
    if context:
        # 只输出定位任务所需的标识，避免意外序列化整个配置或请求对象。
        fields = ("task_id", "job_id", "session_id", "room_id", "segment_id", "platform", "stage", "operation")
        values = [f"{key}={context[key]}" for key in fields if key in context]
        if values:
            message += "\ncontext: " + " ".join(values)
    exception = record["exception"]
    if exception is not None:
        error = exception.value
        if error is not None:
            message += "\n" + safe_exception_summary(error, limit=8192)
            seen: set[int] = set()
            while error is not None and id(error) not in seen:
                seen.add(id(error))
                for frame in traceback.extract_tb(error.__traceback__):
                    message += f"\n  {frame.filename}:{frame.lineno} in {frame.name}"
                error = error.__cause__ or (None if error.__suppress_context__ else error.__context__)
        # Loguru 原始异常渲染会绕过正文脱敏（并可能输出 locals）。
        record["exception"] = None
    record["message"] = sanitize_diagnostic(message, limit=32768)


# 初始化文件/数据库 sink 前的启动诊断也必须脱敏。
logger.configure(patcher=_safe_record)


def setup_logging() -> None:
    """初始化全局日志处理器(幂等)。

    多次调用只会生效一次,避免重复添加 handler 导致日志重复输出。
    """
    global _CONFIGURED
    # Uvicorn 在 CLI 初始化之后可能重新配置日志，lifespan 再次调用时必须重接安全通道。
    for name in ("app", "uvicorn", "uvicorn.error", "uvicorn.access"):
        standard_logger = logging.getLogger(name)
        standard_logger.handlers = [_ApplicationLogHandler()]
        standard_logger.disabled = False
        standard_logger.setLevel(logging.DEBUG if name == "app" else logging.INFO)
        standard_logger.propagate = False
    # dictConfig 还会逐个禁用已存在的业务子 logger，仅恢复父 logger 不够。
    for name, existing_logger in list(logging.Logger.manager.loggerDict.items()):
        if name.startswith("app.") and isinstance(existing_logger, logging.Logger):
            existing_logger.disabled = False
    if _CONFIGURED:
        return

    # 移除 loguru 默认 handler,改用自定义配置。
    logger.remove()
    logger.configure(patcher=_safe_record)

    fmt = (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
    )

    # 控制台:彩色,级别取自配置。
    logger.add(sys.stderr, level=settings.log_level, format=fmt, enqueue=True, diagnose=False, backtrace=False)

    # 文件:按大小轮转 10MB,保留 14 天,压缩为 zip,便于长期追溯。
    logger.add(
        logs_dir() / "blc.log",
        level="DEBUG",
        format=fmt,
        rotation="10 MB",
        retention="14 days",
        compression="zip",
        encoding="utf-8",
        enqueue=True,  # 多进程/多线程安全
        backtrace=False,
        diagnose=False,  # 开发环境也不记录局部变量中的凭据。
    )

    # 数据库 sink:把 WARNING 及以上写入 system_logs,供 Web 后台查看。
    # enqueue=True 让写库发生在独立线程,不阻塞业务;内部已吞掉自身异常,避免递归。
    logger.add(_db_sink, level="WARNING", enqueue=True)

    _CONFIGURED = True
    logger.debug("日志系统已初始化(env={}, level={})", settings.app_env, settings.log_level)


def _db_sink(message: Message) -> None:
    """loguru sink:把一条日志记录写入 ``system_logs`` 表。

    写库异常通过 stderr 报告安全摘要，避免递归调用日志系统。

    :param message: loguru 传入的消息对象(含 ``.record``)。
    """
    try:
        record = message.record.copy()
        _safe_record(record)
        # 延迟导入,规避循环依赖(db -> logging)。
        from app.db.entities import SystemLog
        from app.db.session import get_session

        with get_session() as db:
            db.add(
                SystemLog(
                    level=record["level"].name,
                    module=record["name"],
                    event=record["function"],
                    message=record["message"],
                )
            )
    except Exception as exc:  # noqa: BLE001 — 日志 sink 绝不能抛出
        print(f"数据库日志写入失败 (system_logs sink): {safe_exception_summary(exc)}", file=sys.stderr)
