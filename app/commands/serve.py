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


def _serve_with_parent_pipe(uvicorn, **options: object) -> None:
    """受监管后端通过父进程管道正常退出，兼容没有控制台的 Windows 服务。"""
    import sys
    import threading

    stop_requested = threading.Event()

    class ParentPipeServer(uvicorn.Server):
        async def on_tick(self, counter: int) -> bool:
            # 仅在服务主循环中置退出标记，启动期间收到 EOF 也会执行 lifespan 清理。
            if stop_requested.is_set():
                self.should_exit = True
            return await super().on_tick(counter)

    def watch_parent() -> None:
        try:
            sys.stdin.read(1)
        except (OSError, ValueError):
            pass
        stop_requested.set()

    threading.Thread(target=watch_parent, name="blc-parent-pipe", daemon=True).start()
    ParentPipeServer(uvicorn.Config("app.web.main:app", **options)).run()


def _request_console_stop(processes: list, *, windows: bool) -> None:
    """后端正常收尾；Windows 静态前端不依赖控制台信号即可关闭。"""
    import signal

    for index, process in enumerate(processes):
        if process.poll() is not None:
            continue
        try:
            if windows and index == 0:
                process.stdin.close()
            elif windows:
                process.terminate()
            else:
                process.send_signal(signal.SIGINT)
        except ProcessLookupError:
            pass


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
    if os.environ.pop("_BLC_PARENT_STDIN", "") == "1" and not reload:
        _serve_with_parent_pipe(uvicorn, host=host, port=actual_port, log_config=None)
    else:
        uvicorn.run("app.web.main:app", host=host, port=actual_port, reload=reload, log_config=None, **reload_options)


# 注册列表
def _frontend_directory(frontend_dir: str | None) -> Path:
    """定位显式目录、Portable、wheel 或源码构建，不在运行时调用 npm。"""
    override = frontend_dir if frontend_dir is not None else os.environ.get("BLC_FRONTEND_DIR")
    if override is not None:
        directory = Path(override)
    elif source_dir := os.environ.get("BLC_SOURCE_DIR"):
        directory = Path(source_dir) / "frontend" / "dist"
    else:
        packaged = Path(__file__).resolve().parents[1] / "web" / "ui"
        directory = (
            packaged
            if (packaged / "index.html").is_file()
            else Path(__file__).resolve().parents[2] / "frontend" / "dist"
        )
    directory = directory.resolve()
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
    if os.name == "nt":
        child_env["_BLC_PARENT_STDIN"] = "1"
    processes: list[subprocess.Popen] = []
    shutdown_signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        shutdown_signals.append(signal.SIGBREAK)
    previous_signals = {number: signal.getsignal(number) for number in shutdown_signals}
    closing = False
    force_exit = False
    process_options = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    )

    def terminate(_number, _frame):
        nonlocal force_exit
        if closing:
            force_exit = True
            return
        if _number == signal.SIGINT:
            raise KeyboardInterrupt
        raise SystemExit(0)

    for number in shutdown_signals:
        signal.signal(number, terminate)
    try:
        processes.append(
            subprocess.Popen(
                [sys.executable, "-m", "app.cli", "backend", "--host", "127.0.0.1", "--port", str(api_port)],
                env=child_env,
                **({"stdin": subprocess.PIPE} if os.name == "nt" else {}),
                **process_options,
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
                ],
                **process_options,
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
        closing = True
        try:
            console.print("[yellow]正在停止录制并释放后台资源，再次按 Ctrl+C 可强制退出。[/yellow]")
            _request_console_stop(processes, windows=os.name == "nt")
            # 各服务自行管理关闭期限，不能在 Worker 宽限期结束前强杀 API。
            while any(process.poll() is None for process in processes):
                if force_exit:
                    import psutil

                    console.print("[yellow]强制终止前后端及其子进程。[/yellow]")
                    for process in processes:
                        if process.poll() is not None:
                            continue
                        try:
                            parent = psutil.Process(process.pid)
                            descendants = parent.children(recursive=True)
                        except psutil.NoSuchProcess:
                            continue
                        for owned in [*reversed(descendants), parent]:
                            try:
                                # 资源追踪器须在管道关闭后自行清理命名信号量。
                                if any("multiprocessing.resource_tracker" in arg for arg in owned.cmdline()):
                                    continue
                                owned.kill()
                            except psutil.NoSuchProcess:
                                pass
                    break
                time.sleep(0.1)
            for process in processes:
                process.wait()
        finally:
            for number, previous in previous_signals.items():
                signal.signal(number, previous)


SERVE_COMMANDS = [
    ("backend", cmd_serve, None),
    ("frontend", cmd_frontend, None),
    ("start", cmd_console, None),
    ("serve", cmd_serve, "兼容命令：单独启动后端，与 backend 相同（需安装 web 可选依赖）。"),
    ("console", cmd_console, "兼容命令：启动已构建前端和后端，与 start 相同。"),
]
