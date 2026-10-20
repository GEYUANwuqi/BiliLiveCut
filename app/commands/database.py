"""CLI 子命令 — 数据库维护。"""

from __future__ import annotations

import click
from rich.console import Console

from app.core.config import settings

console = Console()


@click.option("--yes", "-y", default=False, is_flag=True, help="跳过确认提示", show_default=True)
def cmd_db_reset(
    yes: bool = False,
) -> None:
    """重置数据库 (仅供开发使用)。

    删除当前数据库并重新创建。默认会先生成备份。

    :param yes: 跳过确认提示。
    """
    if not yes:
        console.print(f"[red]警告: 这将删除当前数据库并重新创建![/red]\n数据库路径: {settings.database_url}\n")
        from app.db.schema import _db_path

        console.print(f"绝对路径: {_db_path()}\n")
        confirm = click.confirm("确认重置数据库?")
        if not confirm:
            console.print("[yellow]已取消。[/yellow]")
            raise click.exceptions.Exit()

    from app.db.schema import reset_database

    ok = reset_database(yes=yes, backup=True)
    if ok:
        console.print("[green]数据库已重置重建。[/green]")
    else:
        console.print("[red]数据库重置失败, 请检查日志。[/red]")
        raise click.exceptions.Exit(code=1)


@click.option("--days", default=None, type=int, help="保留天数(留空用配置 TREND_RETENTION_DAYS)", show_default=True)
def cmd_trends_purge(
    days: int | None = None,
) -> None:
    """清理超过保留期的网感资料库条目。

    :param days: 保留天数。
    """
    from app.trends.store import purge_old

    n = purge_old(days if days is not None else settings.trend_retention_days)
    console.print(f"[green]已清理 {n} 条过期条目。[/green]")


# 注册列表
DATABASE_COMMANDS = [
    ("db-reset", cmd_db_reset, None),
    ("trends-purge", cmd_trends_purge, None),
]
