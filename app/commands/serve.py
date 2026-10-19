"""CLI 子命令 — Web 服务。"""

from __future__ import annotations

import os
from pathlib import Path

import click
from rich.console import Console

from config.launcher_settings import (
    APP_ROOT_ENV,
    WEB_PORT_ENV,
    LauncherConfigError,
    load_launcher_config,
    runtime_app_root,
    validate_web_port,
)

console = Console()


@click.option("--host", default="127.0.0.1", type=str, help="监听地址", show_default=True)
@click.option(
    "--port",
    default=None,
    type=click.IntRange(1, 65535),
    help="监听端口，默认使用已保存的 Launcher 配置",
    show_default=True,
)
@click.option("--reload", default=False, is_flag=True, help="开发热重载", show_default=True)
def cmd_serve(
    host: str = "127.0.0.1",
    port: int | None = None,
    reload: bool = False,
) -> None:
    """启动 API 服务（需安装 web 可选依赖）。

    页面由独立前端服务提供。

    :param host: 监听地址。
    :param port: 监听端口。
    :param reload: 是否开启热重载。
    """
    try:
        import uvicorn
    except ImportError as exc:
        console.print('[red]未安装 Web 依赖。请执行: pip install -e ".[web]"[/red]')
        raise click.exceptions.Exit(code=1) from exc

    try:
        actual_port = validate_web_port(port if port is not None else load_launcher_config(runtime_app_root()).web_port)
    except LauncherConfigError as exc:
        console.print(f"[red]{exc}[/red]")
        raise click.exceptions.Exit(code=1) from exc
    os.environ[WEB_PORT_ENV] = str(actual_port)
    os.environ.setdefault(APP_ROOT_ENV, str(os.getcwd()))

    # P0: non-loopback requires password
    from app.core.config import settings as _srv_cfg

    if _srv_cfg.docker_auth_enabled:
        from app.core.docker_auth import AuthStore

        # 认证库必须由容器入口先初始化，否则不允许空密码对外监听。
        AuthStore(runtime_app_root()).state()
    if not _srv_cfg.admin_password and not _srv_cfg.docker_auth_enabled:
        from ipaddress import ip_address

        try:
            addr = ip_address(host.replace("localhost", "127.0.0.1"))
            if not addr.is_loopback:
                console.print(
                    "[red]拒绝启动 Web 管理后台：\n"
                    "当前监听地址不是本地地址，但 ADMIN_PASSWORD 为空。\n"
                    "请设置管理员密码或改为 127.0.0.1。[/red]"
                )
                raise click.exceptions.Exit(code=1)
        except ValueError:
            # non-IP hostname (like docker), also require password
            console.print(
                "[red]拒绝启动 Web 管理后台：\n"
                "当前监听地址不是本地地址，但 ADMIN_PASSWORD 为空。\n"
                "请设置管理员密码或改为 127.0.0.1。[/red]"
            )
            raise click.exceptions.Exit(code=1) from None

    console.print(f"[green]API 启动中[/green] -> http://{host}:{actual_port}")
    reload_options = {}
    if reload:
        source_root = Path(__file__).resolve().parents[2]
        reload_options["reload_dirs"] = [str(source_root / "app"), str(source_root / "config")]
    uvicorn.run("app.web.main:app", host=host, port=actual_port, reload=reload, log_config=None, **reload_options)


# 注册列表
def _frontend_directory(frontend_dir: str | None) -> Path:
    """定位源码或 Portable 携带的前端构建，不自动构建或启动开发服务器。"""
    root = Path(os.environ.get("BLC_SOURCE_DIR", Path(__file__).resolve().parents[2]))
    directory = Path(frontend_dir or os.environ.get("BLC_FRONTEND_DIR", str(root / "frontend" / "dist"))).resolve()
    if not (directory / "index.html").is_file():
        raise click.BadParameter(
            f"未找到前端构建: {directory}。请先执行 npm --prefix frontend ci 和 npm --prefix frontend run build。",
            param_hint="--frontend-dir",
        )
    return directory


@click.option("--host", default="127.0.0.1", show_default=True, help="前端监听地址")
@click.option("--port", default=8080, type=click.IntRange(1, 65535), show_default=True, help="前端监听端口")
@click.option("--frontend-dir", type=click.Path(file_okay=False), help="前端构建目录，默认 frontend/dist")
@click.option("--backend", default="http://127.0.0.1:8000", show_default=True, help="反向代理的后端 HTTP 地址")
def cmd_frontend(
    host: str = "127.0.0.1",
    port: int = 8080,
    frontend_dir: str | None = None,
    backend: str = "http://127.0.0.1:8000",
) -> None:
    """单独启动已构建的前端，并把 API 请求代理到指定后端。

    不启动后端、不初始化数据库；后端不可用时 API 请求返回 502。
    开发热更新请在 frontend 目录执行 npm run dev。
    """
    from app.web.frontend_server import serve_frontend, validate_backend

    directory = _frontend_directory(frontend_dir)
    try:
        validate_backend(backend)
    except ValueError as exc:
        raise click.BadParameter(str(exc), param_hint="--backend") from None
    serve_frontend(directory, backend, host, port)


@click.option("--host", default="127.0.0.1", type=str, help="前端监听地址", show_default=True)
@click.option(
    "--port", default=None, type=click.IntRange(1, 65535), help="前端端口，默认使用 Launcher 配置", show_default=True
)
@click.option("--frontend-dir", default=None, type=str, help="独立前端构建目录（frontend/dist）", show_default=True)
def cmd_console(
    host: str = "127.0.0.1",
    port: int | None = None,
    frontend_dir: str | None = None,
) -> None:
    """同时启动独立前端进程和仅监听本机的 API 进程。

    :param host: 前端监听地址。
    :param port: 前端监听端口。
    :param frontend_dir: 已构建的静态资源目录。
    """
    import signal
    import socket
    import subprocess
    import sys
    import time

    directory = _frontend_directory(frontend_dir)
    actual_port = validate_web_port(port if port is not None else load_launcher_config(runtime_app_root()).web_port)
    # 对外发布独立前端同样要求后台密码，不能借助回环代理绕过既有访问边界。
    from app.core.config import settings

    if (
        host not in {"127.0.0.1", "::1", "localhost"}
        and not settings.admin_password
        and not settings.docker_auth_enabled
    ):
        raise click.BadParameter("对外监听需要配置 ADMIN_PASSWORD。")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        api_port = probe.getsockname()[1]
    child_env = {**os.environ, "BLC_FRONTEND_PORT": str(actual_port)}
    processes: list[subprocess.Popen] = []
    shutdown_signals = [signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        shutdown_signals.append(signal.SIGBREAK)
    previous_signals = {number: signal.getsignal(number) for number in shutdown_signals}

    def terminate(_number, _frame):
        raise SystemExit(0)

    for number in shutdown_signals:
        signal.signal(number, terminate)
    try:
        processes.append(
            subprocess.Popen(
                [sys.executable, "-m", "app.cli", "backend", "--host", "127.0.0.1", "--port", str(api_port)],
                env=child_env,
            )
        )
        from urllib.error import URLError
        from urllib.request import ProxyHandler, build_opener

        opener = build_opener(ProxyHandler({}))
        deadline = time.monotonic() + 60
        while True:
            if processes[0].poll() is not None:
                raise RuntimeError("API 启动失败，请检查上方后端日志。")
            try:
                with opener.open(f"http://127.0.0.1:{api_port}/auth/status", timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, URLError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("等待 API 启动超时，请检查数据库与后端配置。")
            time.sleep(0.1)
        processes.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "app.cli",
                    "frontend",
                    "--frontend-dir",
                    str(directory),
                    "--backend",
                    f"http://127.0.0.1:{api_port}",
                    "--host",
                    host,
                    "--port",
                    str(actual_port),
                ]
            )
        )
        console.print(f"[green]工作台启动中[/green] -> http://{host}:{actual_port}")
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
        code = next((process.returncode for process in processes if process.returncode is not None), 1)
        if code:
            raise click.exceptions.Exit(code=code if code > 0 else 1)
    except KeyboardInterrupt:
        pass
    finally:
        for number, previous in previous_signals.items():
            signal.signal(number, previous)
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


SERVE_COMMANDS = [
    ("backend", cmd_serve, None),
    ("frontend", cmd_frontend, None),
    ("start", cmd_console, None),
    ("serve", cmd_serve, "兼容命令：单独启动后端，与 backend 相同（需安装 web 可选依赖）。"),
    ("console", cmd_console, "兼容命令：启动已构建前端和后端，与 start 相同。"),
]
