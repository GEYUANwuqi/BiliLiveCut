"""插件发现、启停与设置 API。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.core.sanitize import safe_exception_summary
from app.plugins.manager import (
    PluginError,
    PluginNotFoundError,
    PluginStateError,
    PluginValidationError,
    plugin_manager,
)

api_router = APIRouter(prefix="/plugins", tags=["plugins"])


class PluginToggleBody(BaseModel):
    """插件启停请求。"""

    model_config = ConfigDict(extra="forbid")
    enabled: bool


class PluginSettingsBody(BaseModel):
    """插件设置保存请求。"""

    model_config = ConfigDict(extra="forbid")
    values: dict[str, str | float | bool | None]


def _http_error(exc: PluginError) -> HTTPException:
    if isinstance(exc, PluginNotFoundError):
        return HTTPException(status_code=404, detail=safe_exception_summary(exc))
    if isinstance(exc, PluginValidationError):
        return HTTPException(status_code=422, detail=safe_exception_summary(exc))
    if isinstance(exc, PluginStateError):
        return HTTPException(status_code=409, detail=safe_exception_summary(exc))
    return HTTPException(status_code=500, detail=safe_exception_summary(exc))


@api_router.get("")
async def list_plugins() -> dict[str, object]:
    """重新扫描并列出插件。"""
    await plugin_manager.refresh()
    return plugin_manager.list_payload()


@api_router.post("/refresh")
async def refresh_plugins() -> dict[str, object]:
    """手动重新扫描插件目录。"""
    await plugin_manager.refresh()
    return plugin_manager.list_payload()


@api_router.patch("/{plugin_id}")
async def toggle_plugin(plugin_id: str, body: PluginToggleBody) -> dict[str, object]:
    """启用或停用一个插件。"""
    try:
        return await plugin_manager.set_enabled(plugin_id, body.enabled)
    except PluginError as exc:
        raise _http_error(exc) from exc


@api_router.get("/{plugin_id}/settings")
async def get_plugin_settings(plugin_id: str) -> dict[str, object]:
    """读取一个已启用插件的设置 Schema 与值。"""
    await plugin_manager.refresh()
    try:
        return plugin_manager.settings_payload(plugin_id)
    except PluginError as exc:
        raise _http_error(exc) from exc


@api_router.patch("/{plugin_id}/settings")
async def save_plugin_settings(plugin_id: str, body: PluginSettingsBody) -> dict[str, object]:
    """校验并保存一个已启用插件的设置。"""
    try:
        return plugin_manager.update_settings(plugin_id, body.values)
    except PluginError as exc:
        raise _http_error(exc) from exc
