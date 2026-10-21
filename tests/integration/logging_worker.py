from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from loguru import logger

from app.core.logging import setup_logging


def _wait(path: Path) -> None:
    deadline = time.monotonic() + 30
    while not path.exists():
        if time.monotonic() >= deadline:
            raise TimeoutError(f"日志测试同步超时：{path.name}")
        time.sleep(0.02)


def main() -> None:
    """使用正式配置触发真实轮转，并等待另一独立进程完成。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("name")
    args = parser.parse_args()
    setup_logging()
    setup_logging()
    logger.debug("rotation-start:{} token=private-rotation-token", args.name)
    logger.complete()
    (args.directory / f"{args.name}.ready").write_text(json.dumps({"pid": os.getpid()}), encoding="utf-8")
    _wait(args.directory / "start")
    for index in range(700):
        logger.debug("rotation-record:{}:{:04d} {}", args.name, index, "x" * 16000)
    logger.complete()
    (args.directory / f"{args.name}.done").touch()
    _wait(args.directory / "finish")
    logger.debug("rotation-end:{}", args.name)
    logger.complete()
    logger.remove()


if __name__ == "__main__":
    main()
