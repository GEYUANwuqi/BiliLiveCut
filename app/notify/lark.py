"""通过企业自建应用的 IM OpenAPI 发送飞书/Lark 运行提醒。"""

from __future__ import annotations

import hashlib
import json
import time
from threading import Lock
from uuid import uuid4

import httpx
from loguru import logger

from app.core.runtime_settings import process_settings

_DOMAINS = {"feishu": "https://open.feishu.cn", "lark": "https://open.larksuite.com"}
_token_lock = Lock()
_cached_token: tuple[str, str, float] | None = None


def configured() -> bool:
    """只有完整的应用凭据与接收对象才能启用通知通道。"""
    config = process_settings()
    return bool(config.lark_app_id and config.lark_app_secret and config.lark_receive_id)


def send_lark(title: str, text: str) -> bool:
    """发送文本消息；凭据、访问令牌和平台原始响应不进入日志。"""
    global _cached_token
    config = process_settings()
    if not config.lark_app_id or not config.lark_app_secret or not config.lark_receive_id:
        return False
    domain = _DOMAINS[config.lark_domain]
    fingerprint = hashlib.sha256(json.dumps([domain, config.lark_app_id, config.lark_app_secret]).encode()).hexdigest()
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            with _token_lock:
                if _cached_token and _cached_token[0] == fingerprint and time.monotonic() < _cached_token[2]:
                    token = _cached_token[1]
                else:
                    response = client.post(
                        domain + "/open-apis/auth/v3/tenant_access_token/internal",
                        json={"app_id": config.lark_app_id, "app_secret": config.lark_app_secret},
                    )
                    response.raise_for_status()
                    result = response.json()
                    if not isinstance(result, dict) or result.get("code") != 0:
                        logger.warning("飞书应用认证失败，请检查应用凭据与服务区域")
                        return False
                    token = result.get("tenant_access_token")
                    expiry = result.get("expire")
                    if not isinstance(token, str) or not token or not isinstance(expiry, int) or expiry <= 0:
                        logger.warning("飞书应用认证响应无效")
                        return False
                    _cached_token = (fingerprint, token, time.monotonic() + max(0, expiry - 60))
            response = client.post(
                domain + "/open-apis/im/v1/messages",
                params={"receive_id_type": config.lark_receive_id_type},
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "receive_id": config.lark_receive_id,
                    "msg_type": "text",
                    "content": json.dumps({"text": f"{title}\n\n{text}"[:6000]}, ensure_ascii=False),
                    "uuid": str(uuid4()),
                },
            )
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict) or result.get("code") != 0:
                with _token_lock:
                    if _cached_token and _cached_token[0] == fingerprint:
                        _cached_token = None
                logger.warning("飞书消息未送达，请检查机器人权限、接收对象及应用发布状态")
                return False
        logger.info("飞书通知已发送")
        return True
    except (httpx.HTTPError, ValueError, TypeError):
        logger.warning("飞书通知失败，请检查网络、应用凭据与接收对象")
        return False


def send_connection_alert(title: str, body: str, alert_key: str) -> bool:
    """工作线程检查当前开关，并按房间/原因持久合并连接提醒。"""
    from app.db.entities import AppSetting
    from app.db.session import get_session

    config = process_settings()
    if not config.notify_enabled or not config.notify_on_connection or not configured():
        return False
    with get_session() as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        key = "lark:alert:" + hashlib.sha256(alert_key.encode()).hexdigest()
        row = db.get(AppSetting, key)
        now = time.time()
        if row and now - float(row.value) < config.notify_connection_cooldown_s:
            return False
        row = row or AppSetting(key=key)
        row.value = str(now)
        db.add(row)
    return send_lark(title, body)
