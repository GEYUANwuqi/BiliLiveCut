"""Path utilities for clip rendering — lease partial and final paths.

All formal paths are keyed by (event_id, variant_type, render_config_hash),
NOT just by candidate_id, to support multi-variant, multi-config rendering.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from app.core.paths import clips_dir


def build_lease_partial_path(task_id: int, lease_token: str) -> str:
    """生成租约专属临时渲染文件路径。

    格式: clips_dir/clip.{task_id}.{lease_token[:8]}.partial.mp4

    :param task_id: SegmentTask ID。
    :param lease_token: 租约令牌 (UUID hex)。
    :returns: 临时文件绝对路径。
    """
    return str(Path(clips_dir()) / f"clip.{task_id}.{lease_token[:8]}.partial.mp4")


def build_final_clip_path(
    event_id: int,
    variant_type: str,
    render_config_hash: str,
) -> str:
    """生成正式切片文件路径 (以 event + variant + config 为键)。

    格式: clips_dir/clip_{event_id}_{variant_type}_{render_config_hash[:8]}.mp4

    :param event_id: HighlightEvent ID。
    :param variant_type: ClipVariantType 值 (single, full_context, etc.)。
    :param render_config_hash: 渲染配置指纹 (SHA-256, 取前8位)。
    :returns: 正式文件绝对路径。
    """
    short_hash = render_config_hash[:8] if render_config_hash else "default"
    return str(Path(clips_dir()) / f"clip_{event_id}_{variant_type}_{short_hash}.mp4")


def build_generation_clip_path(base_path: str, variant_id: int, generation: int, lease_token: str) -> str:
    """为一次租约提交生成独占路径，防止过期任务覆盖新产物。"""
    path = Path(base_path)
    token_hash = hashlib.sha256(lease_token.encode()).hexdigest()[:16]
    return str(path.with_name(f"{path.stem}.v{variant_id}.g{generation}.{token_hash}{path.suffix}"))
