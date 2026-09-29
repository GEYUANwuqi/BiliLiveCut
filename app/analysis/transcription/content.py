"""读取持久化的整理正文，同时保留原始 ASR 文本和词时间戳。"""

from __future__ import annotations

import json

from app.db.entities import Transcript


def refined_transcript_text(transcript: Transcript) -> str | None:
    """仅返回当前格式中已成功持久化的非空整理正文。"""
    try:
        payload = json.loads(transcript.auxiliary_json or "{}")
    except (ValueError, TypeError):
        return None
    refinement = payload.get("transcript_refinement") if isinstance(payload, dict) else None
    if (
        not isinstance(refinement, dict)
        or set(refinement) != {"version", "applied", "clean_text", "summary"}
        or type(refinement["version"]) is not int
        or refinement["version"] != 1
        or refinement["applied"] is not True
        or not isinstance(refinement["summary"], str)
    ):
        return None
    text = refinement.get("clean_text")
    return text.strip() if isinstance(text, str) and text.strip() else None


def transcript_text(transcript: Transcript) -> str:
    """返回用于展示及语义分析的正文。"""
    return refined_transcript_text(transcript) or transcript.final_text
