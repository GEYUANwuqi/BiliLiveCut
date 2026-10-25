"""CLI 子命令 — 配置管理。"""

from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

from app.core.sanitize import safe_exception_summary
from app.models.contracts import TEXT_CAPABILITIES, TextCapability

console = Console()


@click.option("--biliup/--no-biliup", default=None, help="启用/关闭 Biliup 上传", show_default=True)
@click.option("--auto/--no-auto", default=None, help="成品就绪后自动上传", show_default=True)
def cmd_set_upload(
    biliup: bool | None = None,
    auto: bool | None = None,
) -> None:
    """查看或设置上传开关(与 Web 后台共享同一持久化状态)。

    :param biliup: 是否启用 biliup 上传。
    :param auto: 是否自动上传。
    """
    from app.core import settings_store

    values: dict[str, str] = {}
    if biliup is not None:
        values["biliup_enabled"] = "true" if biliup else "false"
    if auto is not None:
        values["auto_upload"] = "true" if auto else "false"
    if values:
        settings_store.set_settings(values)
    console.print(
        f"biliup_enabled={settings_store.biliup_enabled()} "
        f"auto_upload={settings_store.auto_upload_enabled()} "
        f"upload_active={settings_store.upload_active()}"
    )


@click.option("--capability", type=click.Choice(TEXT_CAPABILITIES), default="analysis", show_default=True)
def cmd_llm_list(capability: TextCapability = "analysis") -> None:
    """列出指定文字业务的路由，凭据仅显示是否配置。"""
    from app.analysis import llm_providers as provs

    items = provs.load_providers(capability)
    if not items:
        console.print("[yellow]该业务没有模型路由，请在 Web「模型连接与业务路由」页配置。[/yellow]")
        return
    table = Table(title=f"模型路由 {capability}（按优先级升序）")
    for col in ("priority", "name", "model", "base_url", "key", "enabled"):
        table.add_column(col)
    for p in items:
        hint = "已配置" if p.api_key else "未配置"
        table.add_row(
            str(p.priority),
            p.name,
            p.model,
            p.base_url,
            hint,
            "是" if p.enabled else "否",
        )
    console.print(table)


@click.option("--capability", type=click.Choice(TEXT_CAPABILITIES), default="analysis", show_default=True)
def cmd_llm_test(capability: TextCapability = "analysis") -> None:
    """逐个测试指定文字业务的路由；每条最多两次有限请求，按服务商规则计费。"""
    from openai import OpenAIError

    from app.analysis import llm as llm_mod
    from app.analysis import llm_providers as provs

    providers = provs.active_providers(capability)
    if not providers:
        console.print("[yellow]该业务没有已启用的模型连接和路由。[/yellow]")
        raise click.exceptions.Exit(code=1)
    failed = False
    for p in providers:
        try:
            text = llm_mod.probe_provider(p)
            if not text or not text.strip():
                raise llm_mod.EmptyLLMResponseError("服务未返回可用正文")
            console.print(f"[green]OK[/green] {p.name}({p.model}) -> {text[:40]!r}")
        except (OpenAIError, llm_mod.EmptyLLMResponseError) as exc:
            failed = True
            console.print(f"[red]FAIL[/red] {p.name}({p.model}): {safe_exception_summary(exc)}")
    if failed:
        raise click.exceptions.Exit(code=1)


# 注册列表
CONFIG_COMMANDS = [
    ("set-upload", cmd_set_upload, None),
    ("llm-list", cmd_llm_list, None),
    ("llm-test", cmd_llm_test, None),
]
