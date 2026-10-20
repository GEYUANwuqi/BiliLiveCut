"""导出前端使用的 OpenAPI 契约，不启动服务、不访问业务数据或下载模型。"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    """在独立运行目录导出稳定排序的接口定义。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "frontend/openapi.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="blc-openapi-") as directory:
        os.environ.update(
            BLC_APP_ROOT=directory,
            STORAGE_ROOT=str(Path(directory) / "storage"),
            DATABASE_URL=f"sqlite:///{Path(directory).as_posix()}/schema.db",
            DOCKER_AUTH_ENABLED="false",
            ADMIN_PASSWORD="",
            BILIBILI_COOKIE="",
            ASR_NO_MODEL_DOWNLOAD="1",
        )
        sys.path.insert(0, str(ROOT))
        from app.web.main import app

        content = json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != content:
            print("OpenAPI 契约已变更，请重新导出并生成 TypeScript 类型。")
            return 1
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
