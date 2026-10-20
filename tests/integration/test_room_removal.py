"""直播间移除、历史保留与重新登记的完整行为。"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlmodel import select

from app.db.entities import AppSetting, LiveRoom, RawSegment, RecordingSchedule, RecordingSession, SessionStatus, utcnow
from app.db.session import get_session
from app.sources.rooms import room_is_removed, room_source
from tests.source_fixtures import bind_bilibili_room


def test_remove_room_preserves_history_and_media_and_blocks_recording(temp_db: None, tmp_path: Path) -> None:
    from click import Command
    from click.testing import CliRunner

    from app.commands.record import cmd_list_rooms
    from app.web.main import app

    media = tmp_path / "recording.ts"
    media.write_bytes(b"existing recorded media")
    with get_session() as db:
        room = LiveRoom(
            input_url="123",
            room_id=123,
            uploader_name="保留的主播",
            authorized=True,
            auto_record=True,
            schedule_enabled=True,
        )
        db.add(room)
        db.flush()
        bind_bilibili_room(db, room)
        db.add(LiveRoom(input_url="456", room_id=456))
        session = RecordingSession(room_id=room.id, status=SessionStatus.STOPPED)
        db.add(session)
        db.flush()
        segment = RawSegment(session_id=session.id, seq=0, file_path=str(media))
        db.add(segment)
        db.add(RecordingSchedule(room_id=room.id, scheduled_at=utcnow() + timedelta(hours=1), recurrent="daily"))
        db.flush()
        room_id, session_id, segment_id = room.id, session.id, segment.id

    client = TestClient(app)
    assert client.delete(f"/api/rooms/{room_id}").json() == {"status": "deleted"}
    assert [room["room_id"] for room in client.get("/api/dashboard").json()["rooms"]] == [456]
    assert client.get("/api/schedules").json() == []
    assert client.patch(f"/api/rooms/{room_id}", json={"auto_record": True}).status_code == 404
    assert client.post(f"/api/rooms/{room_id}/start", json={}).status_code == 400
    assert client.post(f"/api/rooms/{room_id}/arm-auto").status_code == 400
    assert (
        client.post(
            "/api/schedules", json={"room_id": room_id, "scheduled_at": (utcnow() + timedelta(hours=1)).isoformat()}
        ).status_code
        == 400
    )
    assert client.delete(f"/api/rooms/{room_id}").status_code == 404
    history = client.get("/api/sessions/history").json()
    assert next(item for item in history if item["session_id"] == session_id)["uploader_name"] == "保留的主播"
    with get_session() as db:
        room = db.get(LiveRoom, room_id)
        assert not room.auto_record and not room.schedule_enabled
        assert room_is_removed(db, room_id)
        assert room_source(room, db).source_id == "123"
        assert db.get(RecordingSession, session_id).room_id == room_id
        assert db.get(RawSegment, segment_id).file_path == str(media)
    assert media.read_bytes() == b"existing recorded media"
    result = CliRunner().invoke(Command("list-rooms", callback=cmd_list_rooms))
    assert result.exit_code == 0, result.output
    assert "123" not in result.output and "456" in result.output


@pytest.mark.parametrize("active", ["task", "enabled"])
def test_remove_recording_room_returns_conflict_without_changes(
    temp_db: None, monkeypatch: MonkeyPatch, active: str
) -> None:
    from app.web.main import app
    from app.web.services.rooms import recorder_manager

    with get_session() as db:
        room = LiveRoom(input_url="123", room_id=123, enabled=active == "enabled", auto_record=True)
        db.add(room)
        db.flush()
        room_id = room.id
        db.add(RecordingSchedule(room_id=room_id, scheduled_at=utcnow()))
    monkeypatch.setattr(recorder_manager, "is_running", lambda _id: active == "task")
    response = TestClient(app).delete(f"/api/rooms/{room_id}")
    assert response.status_code == 409 and "先停止录制" in response.json()["detail"]
    with get_session() as db:
        assert not room_is_removed(db, room_id)
        assert db.get(LiveRoom, room_id).auto_record
        assert len(db.exec(select(RecordingSchedule)).all()) == 1


def test_remove_room_handles_missing_and_local_sources(temp_db: None) -> None:
    from app.web.main import app

    with get_session() as db:
        local = LiveRoom(input_url="local://recording", platform="local")
        db.add(local)
        db.flush()
        local_id = local.id
    client = TestClient(app)
    assert client.delete("/api/rooms/999999").status_code == 404
    assert client.delete(f"/api/rooms/{local_id}").status_code == 400
    with get_session() as db:
        assert not room_is_removed(db, local_id)


def test_remove_unavailable_source_without_resolving_its_identity(temp_db: None) -> None:
    from app.web.main import app

    with get_session() as db:
        room = LiveRoom(input_url="https://missing.invalid/1", platform="missing")
        db.add(room)
        db.flush()
        room_id = room.id
        db.add(AppSetting(key=f"source_room:{room_id}", value="corrupt identity"))
    client = TestClient(app)
    assert client.delete(f"/api/rooms/{room_id}").status_code == 200
    assert client.get("/api/dashboard").json()["rooms"] == []
    with get_session() as db:
        assert db.get(AppSetting, f"source_room:{room_id}").value == "corrupt identity"


def test_readding_removed_room_restores_same_identity_without_automation(
    temp_db: None, monkeypatch: MonkeyPatch
) -> None:
    from app.sources.bilibili.client import BilibiliLiveClient, RoomInfo
    from app.web.main import app

    async def info(self: BilibiliLiveClient, value: str, *, include_detail: bool = True) -> RoomInfo:
        return RoomInfo(123, 1, 99, 0, uploader_name="重新添加的主播")

    monkeypatch.setattr(BilibiliLiveClient, "get_room_info", info)
    client = TestClient(app)
    room_id = client.post("/api/rooms", json={"url": "123", "authorized": True}).json()["id"]
    assert (
        client.patch(f"/api/rooms/{room_id}", json={"auto_record": True, "schedule_enabled": True}).status_code == 200
    )
    assert client.delete(f"/api/rooms/{room_id}").status_code == 200
    assert client.post("/api/rooms", json={"url": "123", "authorized": True}).json()["id"] == room_id
    rooms = client.get("/api/dashboard").json()["rooms"]
    assert len(rooms) == 1 and rooms[0]["id"] == room_id
    assert not rooms[0]["auto_record"] and not rooms[0]["schedule_enabled"]
    with get_session() as db:
        assert not room_is_removed(db, room_id)
        assert len(db.exec(select(LiveRoom)).all()) == 1


async def test_monitor_and_automatic_start_ignore_removed_room(temp_db: None, monkeypatch: MonkeyPatch) -> None:
    from unittest.mock import AsyncMock

    from app.pipeline.live_monitor import LiveMonitor
    from app.web.services.rooms import RecorderManager

    with get_session() as db:
        removed = LiveRoom(input_url="123", room_id=123, auto_record=True)
        active = LiveRoom(input_url="456", room_id=456, auto_record=True)
        db.add(removed)
        db.add(active)
        db.flush()
        removed_id, active_id = removed.id, active.id
    manager = RecorderManager()
    await manager.remove_room(removed_id)
    # 模拟删除前已经排队的自动启动，以及另一写入者留下的旧开关。
    with get_session() as db:
        room = db.get(LiveRoom, removed_id)
        room.auto_record = True
        db.add(room)
    start = AsyncMock()
    monkeypatch.setattr(manager, "_start_locked", start)
    await manager.start(removed_id, automatic=True)
    start.assert_not_awaited()
    monitor = LiveMonitor()
    check = AsyncMock()
    monkeypatch.setattr(monitor, "_check_room", check)
    await monitor._check_all()
    assert [call.args[0].id for call in check.await_args_list] == [active_id]
