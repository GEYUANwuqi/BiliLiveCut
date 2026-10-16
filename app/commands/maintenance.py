"""CLI 子命令 — 维护命令。"""

from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

from app.core.config import settings

console = Console()


@click.argument("clip_id", type=int)
def cmd_upload(
    clip_id: int,
) -> None:
    """对一个成品切片执行上传(阶段5)。

    默认 manual:仅导出待上传清单,不调用平台接口。仅当在后台开启 biliup 开关
    且配置了上传命令时才会真正上传(风险自负)。

    :param clip_id: ``final_clips`` 主键。
    """
    from app.publishing.uploader import enqueue_and_upload

    task = enqueue_and_upload(clip_id)
    console.print(
        f"[green]上传任务[/green] id={task.id} 状态={task.status} 上传器={task.uploader} {task.last_error or ''}"
    )


@click.option(
    "--topic", default="", type=str, help="采集主题提示(留空用默认:近期适合切片的全网热点)", show_default=True
)
def cmd_trends_collect(
    topic: str = "",
) -> None:
    """联网采集近期热门内容并写入网感资料库。

    需配置大模型 API 且 TREND_ENABLED=true。未启用或不可用时不入库。

    :param topic: 采集主题提示。
    """
    from app.trends.collector import collect_and_save

    if not settings.trend_enabled:
        console.print("[yellow]网感资料库未启用(TREND_ENABLED=false)。[/yellow]")
        raise click.exceptions.Exit(code=1)
    saved = collect_and_save(topic)
    console.print(f"[green]采集完成[/green] 新增/更新 {saved} 条。")


@click.option("--limit", default=20, type=int, help="最多显示数量", show_default=True)
@click.option("--days", default=7, type=int, help="仅看最近 N 天", show_default=True)
def cmd_trends_list(
    limit: int = 20,
    days: int = 7,
) -> None:
    """列出网感资料库中的近期热门条目。

    :param limit: 显示上限。
    :param days: 近期窗口(天)。
    """
    from app.trends.store import recent_trends

    rows = recent_trends(limit=limit, days=days)
    if not rows:
        console.print("[yellow]资料库暂无数据。先运行 trends-collect。[/yellow]")
        return
    table = Table(title=f"网感资料库(最近 {days} 天,按热度降序)")
    for col in ("id", "source", "category", "heat", "seen", "title"):
        table.add_column(col)
    for it in rows:
        table.add_row(
            str(it.id),
            it.source,
            it.category or "-",
            f"{it.heat:.0f}",
            str(it.seen_count),
            (it.title or "")[:40],
        )
    console.print(table)


@click.option("--top", default=20, type=int, help="显示前 N 个热词", show_default=True)
@click.option("--days", default=7, type=int, help="近期窗口(天)", show_default=True)
def cmd_trends_keywords(
    top: int = 20,
    days: int = 7,
) -> None:
    """展示近期热门标签/关键词的热度排行。

    :param top: 显示数量。
    :param days: 近期窗口(天)。
    """
    from app.trends.store import keyword_heat

    rows = keyword_heat(days=days, top=top)
    if not rows:
        console.print("[yellow]暂无关键词统计。[/yellow]")
        return
    table = Table(title=f"近期热词(最近 {days} 天)")
    for col in ("keyword", "heat", "count"):
        table.add_column(col)
    for r in rows:
        table.add_row(r["keyword"], str(r["heat"]), str(r["count"]))
    console.print(table)


# 注册列表
MAINTENANCE_COMMANDS = [
    ("upload", cmd_upload, None),
    ("trends-collect", cmd_trends_collect, None),
    ("trends-list", cmd_trends_list, None),
    ("trends-keywords", cmd_trends_keywords, None),
]
