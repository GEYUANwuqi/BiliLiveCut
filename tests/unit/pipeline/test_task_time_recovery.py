"""Real SQLite writes, lease heartbeats and stale recovery share UTC semantics."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from loguru import logger
from sqlalchemy import text
from sqlmodel import Session, select

from app.db.entities import SegmentTask, TaskStatus
from app.db.session import get_session
from app.pipeline import claiming, heartbeat, stale_recovery

NOW = datetime(2026, 10, 8, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def fixed_recovery_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stale_recovery, "now_utc", lambda: NOW)
    monkeypatch.setattr(stale_recovery.settings, "stale_timeout_s", 120)


def test_real_claim_is_recovered_on_the_same_day(temp_db: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(claiming, "now_utc", lambda: NOW - timedelta(minutes=5))
    with get_session() as db:
        db.add(SegmentTask(segment_id=1, session_id=1, stage=TaskStatus.QUEUED_FOR_TRANS))
    task = claiming.pop_and_claim(TaskStatus.QUEUED_FOR_TRANS)
    assert task is not None
    with get_session() as db:
        stored = db.exec(text("SELECT claimed_at, heartbeat_at, started_at FROM segment_tasks")).one()
        assert all(value == "2026-10-08 11:55:00.000000" for value in stored)
    stale_recovery.recover_stale()
    with get_session() as db:
        recovered = db.get(SegmentTask, task.id)
        assert recovered is not None and recovered.stage == TaskStatus.QUEUED_FOR_TRANS
        assert recovered.lease_token is recovered.claimed_by is recovered.claimed_at is None
        assert recovered.heartbeat_at is recovered.next_retry_at is None


@pytest.mark.parametrize("expected_stage", [TaskStatus.ANALYZING, None])
def test_real_heartbeat_write_and_recovery(
    temp_db: None, monkeypatch: pytest.MonkeyPatch, expected_stage: str | None
) -> None:
    monkeypatch.setattr(heartbeat, "now_utc", lambda: NOW - timedelta(minutes=5))
    monkeypatch.setattr(heartbeat, "shutdown_event", threading.Event())
    monkeypatch.setattr(heartbeat, "_HEARTBEAT_POLL_S", 3600)
    with get_session() as db:
        task = SegmentTask(
            segment_id=1,
            session_id=1,
            stage=TaskStatus.ANALYZING,
            claimed_by=heartbeat._WORKER_ID,
            lease_token="lease-a",
        )
        db.add(task)
        db.flush()
        task_id = task.id
    assert task_id is not None
    written = threading.Event()

    @contextmanager
    def observed_session() -> Iterator[Session]:
        with get_session() as db:
            yield db
        written.set()

    monkeypatch.setattr(heartbeat, "get_session", observed_session)
    stop = heartbeat.start_heartbeat_thread(task_id, "lease-a", expected_stage)
    try:
        assert written.wait(5), "Heartbeat did not commit"
    finally:
        stop.set()
        for worker in threading.enumerate():
            if worker.name == f"hb-{task_id}":
                worker.join(5)
                assert not worker.is_alive()
    with get_session() as db:
        stored = db.exec(text("SELECT heartbeat_at FROM segment_tasks")).scalar()
        assert stored == "2026-10-08 11:55:00.000000"
    stale_recovery.recover_stale()
    with get_session() as db:
        task = db.get(SegmentTask, task_id)
        assert task is not None and task.stage == TaskStatus.QUEUED_FOR_ANALYSIS


@pytest.mark.parametrize(
    "stored,expired",
    [
        ("2026-10-08T11:55:00.000000+00:00", True),
        ("2026-10-08 11:55:00.000000", True),
        ("2026-10-08T19:55:00+08:00", True),
        ("2026-10-08T11:57:59.999999+00:00", True),
        ("2026-10-08T11:58:00+00:00", False),
        ("2026-10-08 11:58:00.000001", False),
        ("2026-10-08T12:00:00+00:00", False),
        (None, False),
    ],
)
def test_recovery_compares_instants_not_sqlite_text(temp_db: None, stored: str | None, expired: bool) -> None:
    with get_session() as db:
        db.add(SegmentTask(segment_id=1, session_id=1, stage=TaskStatus.ANALYZING))
    with get_session() as db:
        db.exec(text("UPDATE segment_tasks SET heartbeat_at=:value"), params={"value": stored})
    stale_recovery.recover_stale()
    with get_session() as db:
        task = db.exec(select(SegmentTask)).one()
        assert task.stage == (TaskStatus.QUEUED_FOR_ANALYSIS if expired else TaskStatus.ANALYZING)


def test_recovery_warning_reaches_application_log_sink(temp_db: None) -> None:
    messages: list[str] = []
    with get_session() as db:
        db.add(
            SegmentTask(
                segment_id=1,
                session_id=1,
                stage=TaskStatus.RENDERING,
                heartbeat_at=NOW - timedelta(minutes=5),
            )
        )
    sink = logger.add(lambda message: messages.append(str(message)), level="WARNING")
    try:
        stale_recovery.recover_stale()
    finally:
        logger.remove(sink)
    assert any("recover_stale" in message and "1" in message for message in messages)
