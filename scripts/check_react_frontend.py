"""运行 React 类型、代码与单元检查，依赖由开发者或 CI 显式安装。"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def main() -> int:
    """使用本机 npm，缺少依赖时提供可直接执行的准备命令。"""
    root = Path(__file__).resolve().parents[1]
    npm = shutil.which("npm")
    if npm is None or not (root / "frontend/node_modules/typescript").is_dir():
        print("React 检查需要 Node.js 24；请先执行 npm --prefix frontend ci")
        return 1
    for command in ("typecheck", "lint", "test"):
        result = subprocess.run([npm, "run", command], cwd=root / "frontend", check=False)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
