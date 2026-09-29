"""渲染阶段 Worker — compute/commit 真正分离。

render_compute 渲染到租约专属临时文件, 不写 FinalClip/ClipVariant。
commit_render 在租约保护下提交独占文件，并重新验证审核与来源。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.clipping.paths import build_final_clip_path, build_generation_clip_path, build_lease_partial_path
from app.db.entities import (
    CandidateStatus,
    ClipStatus,
    ClipVariant,
    ClipVariantType,
    FinalClip,
    HighlightCandidate,
    RawSegment,
    RenderStatus,
    SegmentTask,
    TaskStatus,
)
from app.db.session import get_session
from app.pipeline.lease import LeaseLostError, TaskLease, approved_task_candidate, still_owns_lease
from app.pipeline.stage_result import enqueue_next, mark_completed, mark_failed

_logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RenderArtifact:
    """纯计算产物 — 渲染到临时文件的元数据, 不可变。"""

    task_id: int
    lease_token: str
    temporary_path: str
    formal_path: str
    event_id: int
    variant_type: str
    render_config_hash: str
    content_hash: str
    duration_s: float
    size_bytes: int
    width: int | None
    height: int | None
    cover_path: str | None
    stderr_excerpt: str


def _compute_render_config_hash(event_id: int, variant_type: str, duration_s: float) -> str:
    """计算渲染配置指纹 (稳定, 无随机值/时间/worker 信息)。"""
    import hashlib

    raw = f"{event_id}:{variant_type}:dur={duration_s:.1f}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _compute_content_hash(file_path: str) -> str:
    """计算文件内容 SHA-256 (用于同大小不同内容的区分)。"""
    import hashlib

    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha.update(chunk)
    return sha.hexdigest()


def render_compute(lease: TaskLease) -> dict[str, Any]:
    """纯渲染计算 — 仅输出到租约临时文件, 不写 FinalClip/ClipVariant。

    渲染到临时路径 clip.{task_id}.{lease_token[:8]}.partial.mp4。
    不创建 DB 记录, 不推进任务状态。

    :param lease: 任务租约 (提供 task_id + lease_token)。
    :returns: RenderArtifact dict 或 {"error": ...}。
    """
    from app.clipping.core import render_clip_to_file

    temp_path = build_lease_partial_path(lease.task_id, lease.lease_token)

    with get_session() as db:
        task = db.get(SegmentTask, lease.task_id)
        if task is None or task.candidate_id is None:
            return {"error": "task or candidate_id missing", "permanent": True}
        cid = task.candidate_id
        event_id = task.event_id or 0
        candidate = db.get(HighlightCandidate, cid)
        if candidate is None:
            return {"error": "candidate missing", "permanent": True}
        segment = db.get(RawSegment, task.segment_id)
        if segment is None or segment.session_id != task.session_id:
            return {"error": "task/segment source mismatch", "permanent": True}
        if candidate.session_id != task.session_id:
            return {
                "error": (
                    f"task/candidate source mismatch: task_session={task.session_id} "
                    f"candidate_session={candidate.session_id}"
                ),
                "permanent": True,
            }

    try:
        artifact = render_clip_to_file(cid, temp_path)
    except Exception as exc:
        permanent = _is_render_error_permanent(exc)
        return {"error": f"RenderError: {exc}", "permanent": permanent}

    if not artifact:
        return {"error": "clip rendering returned no result", "permanent": False}

    fpath = artifact.get("file_path", "")
    if not fpath or not Path(fpath).exists():
        return {"error": "output file missing", "permanent": False}

    size_bytes = artifact.get("size_bytes", Path(fpath).stat().st_size if Path(fpath).exists() else 0)
    if size_bytes <= 1024:
        return {"error": f"output too small ({size_bytes} bytes)", "permanent": False}

    duration_s = artifact.get("duration_s", 0)
    if duration_s < 1.0:
        return {"error": f"output duration too short ({duration_s:.1f}s)", "permanent": False}

    # 计算 content_hash (SHA-256, 用于区分同大小不同内容)
    content_hash = _compute_content_hash(temp_path)
    variant_type = ClipVariantType.SINGLE
    render_config_hash = _compute_render_config_hash(event_id, variant_type, duration_s)

    return {
        "task_id": lease.task_id,
        "lease_token": lease.lease_token,
        "temp_path": temp_path,
        "formal_path": build_final_clip_path(event_id, variant_type, render_config_hash),
        "candidate_id": cid,
        "event_id": event_id,
        "variant_type": variant_type,
        "render_config_hash": render_config_hash,
        "content_hash": content_hash,
        "duration_s": duration_s,
        "size_bytes": size_bytes,
        "width": artifact.get("width"),
        "height": artifact.get("height"),
        "cover_path": artifact.get("cover_path"),
    }


def _render_context(db: Session, lease: TaskLease, result: dict[str, Any]) -> tuple[SegmentTask, HighlightCandidate]:
    """在当前写事务重新验证租约及计算结果的来源。"""
    if not still_owns_lease(db, lease):
        raise LeaseLostError()
    task = db.get(SegmentTask, lease.task_id)
    assert task is not None
    candidate = approved_task_candidate(db, task)
    if result.get("candidate_id") != candidate.id or result.get("event_id") != task.event_id:
        raise ValueError("渲染结果与任务来源不一致")
    return task, candidate


def _clip_for_variant(db: Session, variant: ClipVariant, candidate_id: int) -> FinalClip:
    """取得实际成片记录；恢复已就位但尚未登记的产物。"""
    clip = db.exec(
        select(FinalClip).where(
            FinalClip.candidate_id == candidate_id,
            FinalClip.file_path == variant.file_path,
        )
    ).first()
    if clip is None:
        clip = FinalClip(
            candidate_id=candidate_id,
            file_path=variant.file_path,
            duration_s=variant.duration_s,
            content_hash=variant.file_hash,
            status=ClipStatus.GENERATED,
        )
        db.add(clip)
        db.flush()
    if clip.status == ClipStatus.REJECTED:
        raise ValueError("成片已被拒绝")
    return clip


def commit_render(lease: TaskLease, compute_result: dict[str, Any], ms: int) -> None:
    """以双短事务提交独占产物，两次校验租约、审核和来源。

    文件阶段不占用数据库写锁；每一 generation 使用独占路径，失败时只
    删除本次产物，保留旧成片及其它租约的文件。
    """
    temp_path = compute_result.get("temp_path", "")
    output_path = ""
    variant_id: int | None = None
    generation = 0
    try:
        with get_session() as db:
            if db.get_bind().dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            if not still_owns_lease(db, lease):
                raise LeaseLostError()
            task = db.get(SegmentTask, lease.task_id)
            assert task is not None
            if "error" in compute_result:
                mark_failed(task, compute_result["error"], permanent=compute_result.get("permanent", False))
                db.add(task)
                return
            task, candidate = _render_context(db, lease, compute_result)
            variant = db.exec(
                select(ClipVariant).where(
                    ClipVariant.event_id == task.event_id,
                    ClipVariant.variant_type == compute_result.get("variant_type", ClipVariantType.SINGLE),
                    ClipVariant.render_config_hash == compute_result["render_config_hash"],
                )
            ).first()
            if (
                variant is not None
                and variant.render_status == RenderStatus.DONE
                and variant.file_path
                and Path(variant.file_path).is_file()
            ):
                clip = _clip_for_variant(db, variant, candidate.id)
                candidate.status = CandidateStatus.CLIPPED
                db.add(candidate)
                _update_rendered_task(db, task, clip, ms)
                return
            if variant is None:
                variant = ClipVariant(
                    event_id=task.event_id,
                    variant_type=compute_result.get("variant_type", ClipVariantType.SINGLE),
                    render_config_hash=compute_result["render_config_hash"],
                    generation=0,
                )
                db.add(variant)
                db.flush()
            assert variant.id is not None
            variant_id = variant.id
            variant.generation += 1
            generation = variant.generation
            output_path = build_generation_clip_path(
                compute_result["formal_path"], variant_id, generation, lease.lease_token
            )
            variant.file_path = output_path
            variant.file_hash = compute_result["content_hash"]
            variant.duration_s = compute_result["duration_s"]
            variant.render_status = RenderStatus.QUEUED
            db.add(variant)

        Path(temp_path).replace(output_path)

        with get_session() as db:
            if db.get_bind().dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            task, candidate = _render_context(db, lease, compute_result)
            variant = db.get(ClipVariant, variant_id)
            if variant is None or variant.generation != generation or variant.file_path != output_path:
                raise LeaseLostError()
            variant.render_status = RenderStatus.DONE
            db.add(variant)
            clip = _clip_for_variant(db, variant, candidate.id)
            candidate.status = CandidateStatus.CLIPPED
            db.add(candidate)
            _update_rendered_task(db, task, clip, ms)
        output_path = ""  # 已提交的产物由成片生命周期管理。
    except LeaseLostError:
        _logger.warning("stale_result_discarded: render task=%s", lease.task_id)
    except (OSError, ValueError) as exc:
        with get_session() as db:
            if db.get_bind().dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            if still_owns_lease(db, lease):
                task = db.get(SegmentTask, lease.task_id)
                assert task is not None
                mark_failed(task, f"渲染提交失败: {exc}", permanent=isinstance(exc, ValueError))
                db.add(task)
            variant = db.get(ClipVariant, variant_id) if variant_id is not None else None
            if (
                variant is not None
                and variant.generation == generation
                and variant.render_status == RenderStatus.QUEUED
            ):
                variant.render_status = RenderStatus.FAILED
                db.add(variant)
    finally:
        _safe_delete_temp(temp_path)
        if output_path:
            # 提交异常可能发生在服务器实际提交之后；仍被引用的文件不能删除。
            try:
                with get_session() as db:
                    if db.get_bind().dialect.name == "sqlite":
                        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
                    referenced = db.exec(select(FinalClip.id).where(FinalClip.file_path == output_path)).first()
                    if referenced is None:
                        _safe_delete_temp(output_path)
                        variant = db.get(ClipVariant, variant_id)
                        if (
                            variant is not None
                            and variant.generation == generation
                            and variant.file_path == output_path
                        ):
                            variant.render_status = RenderStatus.FAILED
                            db.add(variant)
            except SQLAlchemyError:
                _logger.exception("render_cleanup_deferred: task=%s path=%s", lease.task_id, output_path)


def _update_rendered_task(db: Session, task: SegmentTask, clip: FinalClip, ms: int) -> None:
    """使用实际 FinalClip 主键推进任务，不混用 ClipVariant 主键。"""
    assert clip.id is not None
    mark_completed(task, ms)
    enqueue_next(task, TaskStatus.RENDERED, clip_id=clip.id)
    db.add(task)


def _is_render_error_permanent(exc: Exception) -> bool:
    """从渲染异常提取 FFmpeg 错误类型, 判断是否永久失败。"""
    import re

    from app.core.ffmpeg_errors import FfmpegErrorType, classify_ffmpeg_error, is_retryable

    msg = str(exc)
    m = re.search(r"\[([A-Z_]+)\]", msg)
    if m:
        type_name = m.group(1)
        try:
            error_type = FfmpegErrorType[type_name]
            return not is_retryable(error_type)
        except KeyError:
            pass
    if isinstance(exc, RuntimeError):
        stderr_marker = "]: "
        idx = msg.find(stderr_marker)
        extracted_stderr = msg[idx + len(stderr_marker) :] if idx != -1 else msg
        error_type = classify_ffmpeg_error(-1, extracted_stderr)
        if error_type != FfmpegErrorType.UNKNOWN:
            return not is_retryable(error_type)
    return False


def _safe_delete_temp(temp_path: str) -> None:
    """安全删除租约临时文件, 不抛异常。"""
    if not temp_path:
        return
    try:
        tp = Path(temp_path)
        if tp.exists():
            tp.unlink()
            _logger.info("safe_delete_temp: %s", temp_path)
    except OSError:
        _logger.warning("safe_delete_temp_failed: %s", temp_path, exc_info=True)


def run_render(lease: TaskLease) -> None:
    """渲染阶段入口 — compute → commit。"""
    t0 = time.time()
    compute_result = render_compute(lease)
    ms_val = int((time.time() - t0) * 1000)
    commit_render(lease, compute_result, ms_val)
