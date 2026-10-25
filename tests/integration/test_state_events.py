from __future__ import annotations

import asyncio
import base64
import multiprocessing
import socket
import sqlite3
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi import Request
from sqlalchemy.exc import IntegrityError
from starlette.requests import ClientDisconnect

from app.core.notifications import Change, NotificationBus, SubscriptionLimit
from app.db.entities import AppSetting, LiveRoom
from app.db.session import get_session


@pytest.fixture
def bus(monkeypatch: pytest.MonkeyPatch) -> NotificationBus:
    from app.db import notifications as db_events
    from app.web.routers import events

    value = NotificationBus(capacity=4, scopes=4, readers=4, per_owner=2)
    monkeypatch.setattr(db_events, "notifications", value)
    monkeypatch.setattr(events, "notifications", value)
    return value


def test_scope_cursor_replay_overflow_and_limits(bus: NotificationBus) -> None:
    alice = bus.subscribe("reviewer", "alice")
    bob = bus.subscribe("reviewer", "bob")
    admin = bus.subscribe("admin", "admin")
    alice_cursor, bob_cursor = alice.resync().cursor, bob.resync().cursor
    admin_cursor = admin.resync().cursor
    bus.publish({Change("state"), Change("jobs", "alice")})
    assert alice.read(alice_cursor)[0].topics == ("jobs",)
    assert bob.read(bob_cursor) == ()
    assert admin.read(admin_cursor)[0].topics == ("jobs", "state")
    assert bob.read(alice_cursor)[0].kind == "resync"
    twin = bus.subscribe("reviewer", "alice")
    with pytest.raises(SubscriptionLimit):
        bus.subscribe("reviewer", "alice")
    twin.close()
    twin.close()
    for _ in range(7):
        bus.publish({Change("review")})
    assert alice.read(alice_cursor)[0].kind == "resync"
    cursor = alice.resync().cursor
    alice.close()
    with pytest.raises(RuntimeError):
        alice.read(cursor)
    replacement = bus.subscribe("reviewer", "alice")
    assert replacement.read(cursor) == ()
    replacement.close()
    bob.close()
    admin.close()
    for index in range(12):
        stream = bus.subscribe("reviewer", str(index))
        stream.close()
    restored = bus.subscribe("reviewer", "alice")
    assert restored.read(cursor)[0].kind == "resync"
    restored.close()


def test_nested_transaction_notifications_follow_outer_commit(temp_db: None, bus: NotificationBus) -> None:
    stream = bus.subscribe("admin", "admin")
    cursor = stream.resync().cursor
    with pytest.raises(RuntimeError, match="rollback"):
        with get_session() as db:
            with db.begin_nested():
                db.add(AppSetting(key="nested-rollback", value="private-value"))
            assert stream.read(cursor) == ()
            raise RuntimeError("rollback")
    assert stream.read(cursor) == ()
    with get_session() as db:
        db.add(AppSetting(key="outer", value="safe"))
        db.flush()
        with pytest.raises(RuntimeError, match="savepoint"):
            with db.begin_nested():
                db.add(AppSetting(key="inner", value="rolled-back"))
                db.flush()
                raise RuntimeError("savepoint")
        assert stream.read(cursor) == ()
    (notice,) = stream.read(cursor)
    assert notice.kind == "invalidate" and notice.topics == ("state",)
    with get_session() as db:
        assert db.get(AppSetting, "inner") is None
        assert db.get(AppSetting, "outer") is not None
    cursor = notice.cursor
    with pytest.raises(IntegrityError):
        with get_session() as db:
            db.add(AppSetting(key="outer", value="duplicate-key"))
    assert stream.read(cursor) == ()
    with get_session() as db:
        with db.begin_nested():
            db.add(AppSetting(key="nested-success", value="private-value"))
        assert stream.read(cursor) == ()
    assert len(stream.read(cursor)) == 1
    stream.close()


def test_failed_commit_and_foreign_jobs_do_not_notify_reviewers(temp_db: None, bus: NotificationBus) -> None:
    from app.db.job_store import register
    from tests.integration.test_job_transactions import _job

    alice, bob = bus.subscribe("reviewer", "alice"), bus.subscribe("reviewer", "bob")
    a, b = alice.resync().cursor, bob.resync().cursor
    register(_job(owner="alice"))
    assert alice.read(a)[0].topics == ("jobs",)
    assert bob.read(b) == ()
    with pytest.raises(ValueError, match="reject"):
        with get_session() as db:
            db.add(AppSetting(key="rolled-back", value="secret"))
            db.flush()
            raise ValueError("reject")
    assert bob.read(b) == ()
    alice.close()
    bob.close()


@pytest.fixture
def live_events(temp_db: None, bus: NotificationBus, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    from app.web import main
    from app.web.routers import events

    monkeypatch.setattr(main, "_DOCKER_AUTH", None)
    monkeypatch.setattr(main, "_ADMIN_PASSWORD", "event-password")
    monkeypatch.setattr(main, "_REVIEWER_PASSWORDS", {"alice": "review-password"})
    monkeypatch.setattr(main, "_LOGIN_FAILURES", {})
    monkeypatch.setattr(events, "_POLL_SECONDS", 0.02)
    monkeypatch.setattr(events, "_HEARTBEAT_SECONDS", 0.05)
    monkeypatch.setattr(events, "_RESYNC_SECONDS", 0.15)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(32)
    server = uvicorn.Server(uvicorn.Config(main.app, lifespan="off", log_config=None, access_log=False))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]})
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            assert thread.is_alive() and time.monotonic() < deadline
            time.sleep(0.01)
        yield f"http://127.0.0.1:{listener.getsockname()[1]}"
    finally:
        server.should_exit = True
        thread.join(10)
        listener.close()
        assert not thread.is_alive()


def _headers(username: str = "admin", password: str = "event-password") -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()}


def test_real_stream_revokes_basic_and_rejects_cross_origin(live_events: str, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.web import main

    with httpx.Client(base_url=live_events, headers=_headers(), timeout=3) as client:
        assert client.get("/api/events", headers={"Origin": "https://foreign.invalid"}).status_code == 403
        assert client.get("/api/events?token=forbidden").status_code == 400
        assert client.get("/api/events", headers={"Last-Event-ID": "x" * 81}).status_code == 400
        with client.stream("GET", "/api/events") as response:
            assert response.status_code == 200
            assert response.headers["x-accel-buffering"] == "no"
            lines = response.iter_lines()
            assert next(lines).startswith("id: ")
            assert next(lines) == "event: resync"
            monkeypatch.setattr(main, "_ADMIN_PASSWORD", "changed-password")
            assert "event: auth-expired" in list(lines)


def test_real_reviewer_stream_only_receives_own_job_hints(live_events: str, bus: NotificationBus) -> None:
    with httpx.Client(base_url=live_events, headers=_headers("alice", "review-password"), timeout=3) as client:
        with client.stream("GET", "/api/events") as response:
            assert response.status_code == 200
            lines = response.iter_lines()
            for _ in range(4):
                next(lines)
            bus.publish({Change("jobs", "someone-else"), Change("state")})
            assert next(lines) == ": keepalive"
            bus.publish({Change("jobs", "alice")})
            observed = []
            for line in lines:
                observed.append(line)
                if line.startswith("data:"):
                    break
            assert 'data: {"version":1,"topics":["jobs"]}' in observed
            assert not any("someone-else" in line or "state" in line for line in observed)
        assert client.get("/api/rooms").status_code == 403


@pytest.mark.parametrize("session_cookie", [True, False])
def test_real_docker_stream_ends_when_session_or_password_is_revoked(
    live_events: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, session_cookie: bool
) -> None:
    from app.core.docker_auth import COOKIE_NAME, AuthStore
    from app.web import main

    store = AuthStore(tmp_path / "auth", idle_seconds=60, session_seconds=300)
    code = store.boot("")
    assert code
    store.initialize(code, "event-password-long", "setup")
    identity = store.authenticate("admin", "event-password-long", {}, "login", create_session=True)
    assert identity
    monkeypatch.setattr(main, "_DOCKER_AUTH", store)
    with httpx.Client(base_url=live_events, timeout=3) as client:
        if session_cookie:
            client.cookies.set(COOKIE_NAME, identity["token"])
        else:
            client.headers.update(_headers(password="event-password-long"))
        with client.stream("GET", "/api/events") as response:
            assert response.status_code == 200
            lines = response.iter_lines()
            for _ in range(4):
                next(lines)
            if session_cookie:
                store.logout(identity["token"])
            else:
                store.reset()
            assert "event: auth-expired" in list(lines)


def _update_room(path: str) -> None:
    with sqlite3.connect(path) as db:
        db.execute("UPDATE live_rooms SET title = ?", ("来自其他进程",))


def test_periodic_resync_recovers_other_process_commit(live_events: str) -> None:
    from app.db import session

    with get_session() as db:
        db.add(LiveRoom(input_url="1", room_id=1, title="初始标题"))
    with httpx.Client(base_url=live_events, headers=_headers(), timeout=5) as client:
        with client.stream("GET", "/api/events") as response:
            lines = response.iter_lines()
            for _ in range(4):
                next(lines)
            worker = multiprocessing.get_context("spawn").Process(
                target=_update_room, args=(session.engine.url.database,)
            )
            worker.start()
            worker.join(10)
            assert worker.exitcode == 0
            assert any(line == "event: resync" for line in lines)
            restored = client.get("/api/dashboard")
            assert restored.status_code == 200
            assert restored.json()["rooms"][0]["title"] == "来自其他进程"


def test_docker_stream_checks_revocation_without_refreshing_idle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.docker_auth import AuthStore, token_hash
    from app.web import main
    from app.web.routers.events import still_authorized

    store = AuthStore(tmp_path, idle_seconds=60, session_seconds=300)
    code = store.boot("")
    assert code
    store.initialize(code, "event-password-long", "setup")
    identity = store.authenticate("admin", "event-password-long", {}, "login", create_session=True)
    assert identity
    token = identity["token"]
    monkeypatch.setattr(main, "_DOCKER_AUTH", store)
    request = Request(
        {"type": "http", "headers": [], "state": {"auth_user": "admin", "auth_role": "admin", "auth_session": token}}
    )
    with store.connect() as db:
        seen = db.execute("SELECT seen FROM sessions WHERE token=?", (token_hash(token),)).fetchone()[0]
    assert still_authorized(request)
    with store.connect() as db:
        assert db.execute("SELECT seen FROM sessions WHERE token=?", (token_hash(token),)).fetchone()[0] == seen
    store.logout(token)
    assert not still_authorized(request)


async def test_slow_sender_times_out_and_releases_registration(
    bus: NotificationBus, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.web import main
    from app.web.routers import events

    monkeypatch.setattr(main, "_DOCKER_AUTH", None)
    monkeypatch.setattr(main, "_ADMIN_PASSWORD", "")
    monkeypatch.setattr(events, "_SEND_TIMEOUT", 0.02)
    subscription = bus.subscribe("admin", "local-admin")
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/events",
        "headers": [],
        "asgi": {"spec_version": "2.4"},
        "state": {"auth_user": "local-admin", "auth_role": "admin"},
    }

    async def receive() -> dict[str, object]:
        await asyncio.sleep(10)
        return {"type": "http.disconnect"}

    async def send(_message: dict[str, object]) -> None:
        await asyncio.sleep(10)

    response = events._EventResponse(Request(scope, receive), subscription, "")
    started = time.monotonic()
    with pytest.raises(ClientDisconnect) as caught:
        await response(scope, receive, send)
    assert isinstance(caught.value.__context__, TimeoutError)
    assert time.monotonic() - started < 1
    with pytest.raises(RuntimeError, match="关闭"):
        subscription.read("")
    replacements = [bus.subscribe("admin", "local-admin") for _ in range(2)]
    for value in replacements:
        value.close()
