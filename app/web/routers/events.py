# ruff: noqa: D100
from __future__ import annotations

import asyncio
import base64
import json
import secrets
from collections.abc import AsyncIterator
from functools import partial
from typing import cast

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse
from starlette.types import Message, Receive, Scope, Send

from app.core.execution import run_sync
from app.core.notifications import Notice, Role, Subscription, SubscriptionLimit, notifications

router = APIRouter()
_POLL_SECONDS = 1.0
_HEARTBEAT_SECONDS = 10.0
_RESYNC_SECONDS = 30.0
_SEND_TIMEOUT = 10.0


def still_authorized(request: Request) -> bool:
    """持续验证当前身份；通知流不延长 Docker 会话空闲期限。"""
    from app.web import main

    owner, role = request.state.auth_user, request.state.auth_role
    store = main._DOCKER_AUTH
    token = getattr(request.state, "auth_session", "")
    if store is not None and token:
        session = store.session(token, touch=False)
        return bool(
            session
            and session["username"] == owner
            and session["role"] == role
            and (role == "admin" or owner in main._REVIEWER_PASSWORDS)
        )
    if store is not None and role == "admin":
        return store.admin_authorized(credential_version=getattr(request.state, "auth_credential_version", ""))
    if store is None and owner == "local-admin":
        return not main._ADMIN_PASSWORD
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Basic ") or len(authorization) > 4096:
        return False
    try:
        username, separator, password = base64.b64decode(authorization[6:], validate=True).decode().partition(":")
    except (ValueError, UnicodeError):
        return False
    expected = main._ADMIN_PASSWORD if role == "admin" else main._REVIEWER_PASSWORDS.get(owner)
    return bool(
        separator and username == owner and expected and secrets.compare_digest(password.encode(), expected.encode())
    )


def _encode(notice: Notice) -> bytes:
    data = json.dumps({"version": 1, "topics": notice.topics}, separators=(",", ":"))
    return f"id: {notice.cursor}\nevent: {notice.kind}\ndata: {data}\n\n".encode()


async def event_stream(request: Request, subscription: Subscription, cursor: str) -> AsyncIterator[bytes]:
    """提供有界续传、授权续验和定期 HTTP 恢复提示。"""
    from app.web import main

    reviewer_password = main._REVIEWER_PASSWORDS.get(request.state.auth_user, "")
    loop = asyncio.get_running_loop()
    heartbeat_at, resync_at = loop.time() + _HEARTBEAT_SECONDS, loop.time() + _RESYNC_SECONDS
    while not await request.is_disconnected():
        reviewer_changed = request.state.auth_role == "reviewer" and not secrets.compare_digest(
            reviewer_password.encode(), main._REVIEWER_PASSWORDS.get(request.state.auth_user, "").encode()
        )
        if reviewer_changed or not await run_sync(partial(still_authorized, request)):
            yield b"event: auth-expired\ndata: {}\n\n"
            return
        now = loop.time()
        notices = subscription.read(cursor)
        if now >= resync_at:
            notices = (subscription.resync(),)
            resync_at = now + _RESYNC_SECONDS
        for notice in notices:
            yield _encode(notice)
            cursor = notice.cursor
        if now >= heartbeat_at:
            yield b": keepalive\n\n"
            heartbeat_at = now + _HEARTBEAT_SECONDS
        await asyncio.sleep(_POLL_SECONDS)


class _EventResponse(StreamingResponse):
    """限制慢客户端的单次发送等待，并在所有退出路径释放登记。"""

    def __init__(self, request: Request, subscription: Subscription, cursor: str) -> None:
        self.subscription = subscription
        super().__init__(
            event_stream(request, subscription, cursor),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-store",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """在传输取消、错误或正常关闭时结束生成器与订阅。"""

        async def bounded_send(message: Message) -> None:
            async with asyncio.timeout(_SEND_TIMEOUT):
                await send(message)

        try:
            await super().__call__(scope, receive, bounded_send)
        finally:
            try:
                await self.body_iterator.aclose()
            finally:
                self.subscription.close()


@router.get("/events", response_class=StreamingResponse)
async def events(request: Request) -> StreamingResponse:
    """订阅当前账号可见的状态提示；所有业务数据仍由 HTTP 查询。"""
    from app.web.main import _AuthMiddleware

    if request.headers.get("sec-fetch-site") == "cross-site" or not _AuthMiddleware._check_csrf(request):
        raise HTTPException(403, "跨站通知请求被拒绝")
    if request.query_params:
        raise HTTPException(400, "通知接口不接受查询参数，请使用认证头和 Last-Event-ID")
    cursor = request.headers.get("last-event-id", "")
    if len(cursor) > 80 or any(ord(character) < 32 or ord(character) > 126 for character in cursor):
        raise HTTPException(400, "通知游标格式错误")
    try:
        subscription = notifications.subscribe(cast(Role, request.state.auth_role), request.state.auth_user)
    except SubscriptionLimit as exc:
        raise HTTPException(429, str(exc), headers={"Retry-After": "30"}) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _EventResponse(request, subscription, cursor)
