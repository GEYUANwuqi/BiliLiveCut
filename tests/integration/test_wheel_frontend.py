"""真实 sdist → wheel → 安装 → 双端启动的发行回归。"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import sysconfig
import venv
import zipfile
from pathlib import Path


def test_sdist_builds_wheel_with_fresh_frontend_and_runs_without_node(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[2]
    source = tmp_path / "source"
    source.mkdir()
    for name in ("app", "config", "frontend", "tools", "docs", "plugin"):
        shutil.copytree(
            root / name,
            source / name,
            ignore=shutil.ignore_patterns(
                "node_modules",
                "dist",
                "build",
                "target",
                "__pycache__",
                ".cache",
                ".temp",
                "test-results",
                "playwright-report",
                "*.so",
                "*.pyd",
            ),
        )
    for name in ("setup.py", "pyproject.toml", "MANIFEST.in", "README.md", "LICENSE"):
        shutil.copy2(root / name, source / name)
    stale = source / "frontend" / "dist"
    stale.mkdir()
    (stale / "index.html").write_text("STALE FRONTEND MUST NOT SHIP")
    env = {**os.environ, "BLC_SKIP_C_EXTENSIONS": "1"}
    with (tmp_path / "build.log").open("w+", encoding="utf-8") as log:
        result = subprocess.run(
            [sys.executable, "-m", "build", "--no-isolation"], cwd=source, env=env, stdout=log, stderr=log, timeout=600
        )
        log.seek(0)
        assert result.returncode == 0, log.read()[-12000:]
    wheel = next((source / "dist").glob("*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        assert b"STALE FRONTEND" not in archive.read("app/web/ui/index.html")
        assert "app/web/ui/media-auth.js" in names
        assert any(name.startswith("app/web/ui/assets/") and name.endswith(".js") for name in names)
        assert any(name.startswith("app/web/ui/assets/") and name.endswith(".css") for name in names)
        assert not any(name.startswith(("app/web/templates/", "app/web/static/", "frontend/")) for name in names)
    environment = tmp_path / "installed"
    venv.EnvBuilder(with_pip=True).create(environment)
    site = environment / (
        "Lib/site-packages"
        if os.name == "nt"
        else f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages"
    )
    # 复用测试环境已经安装的依赖；wheel 自身包位于它们之前，-I 仍排除源码路径。
    (site / "test-runtime-dependencies.pth").write_text(sysconfig.get_path("purelib") + "\n", encoding="utf-8")
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run(
        [str(python), "-m", "pip", "install", "--no-deps", "--force-reinstall", str(wheel)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    # -I 排除源码 PYTHONPATH，确保运行来自刚安装的 wheel。
    result = subprocess.run(
        [str(python), "-I", str(root / "scripts/smoke_wheel_frontend.py")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "wheel frontend smoke OK" in result.stdout
