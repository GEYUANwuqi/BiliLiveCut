"""仪表盘."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.web.services import dashboard as dashboard_service

router = APIRouter()


@router.get("/dashboard")
def get_dashboard() -> dict[str, Any]:
    """返回仪表盘概览数据。"""
    return dashboard_service.dashboard_state()
