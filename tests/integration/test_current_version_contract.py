"""当前版本只接受正式配置及来源证据，不补写历史格式。"""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlmodel import select

from app.core.config import Settings
from app.core.configuration import ConfigurationChange, configuration_view, save_configuration
from app.db.entities import AppSetting, Danmaku, LiveRoom, RecordingSession
from app.db.session import get_session


@pytest.mark.parametrize("key", ["asr_confidence_threshold", "asr_model_revision", "uploader", "MAX_TRANSCRIBING"])
def test_removed_configuration_is_rejected(temp_db: None, tmp_path: Path, key: str) -> None:
    assert key.lower() not in {field["key"] for field in configuration_view()["fields"]}
    with pytest.raises(ValueError, match="未注册"):
        save_configuration(ConfigurationChange(values={key: "old"}))
    env = tmp_path / ".env"
    env.write_text(f"{key}=old\n", encoding="utf-8")
    with pytest.raises(ValidationError):
        Settings(_env_file=env)


@pytest.mark.parametrize("alias", ["funasr", "nano"])
def test_old_primary_alias_is_rejected(alias: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, asr_primary=alias)


async def test_unbound_bilibili_room_is_rejected_without_backfill(
    temp_db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.plugins.live_source import SourceInvalidInput
    from app.sources.bilibili.client import BilibiliLiveClient, RoomInfo
    from app.sources.rooms import register_room, room_source

    async def info(self: BilibiliLiveClient, value: str, *, include_detail: bool = True) -> RoomInfo:
        return RoomInfo(123, 1, 99, 0)

    monkeypatch.setattr(BilibiliLiveClient, "get_room_info", info)
    with get_session() as db:
        room = LiveRoom(room_id=123, input_url="123", authorized=True)
        db.add(room)
        db.flush()
    with pytest.raises(SourceInvalidInput, match="反向索引"):
        room_source(room)
    with pytest.raises(SourceInvalidInput, match="不能自动补写"):
        await register_room("123", True)
    with get_session() as db:
        assert len(db.exec(select(LiveRoom)).all()) == 1
        assert db.exec(select(AppSetting).where(AppSetting.key.startswith("source_"))).all() == []


def test_danmaku_rows_without_capture_evidence_are_unavailable(temp_db: None) -> None:
    from app.analysis.source_policy import session_danmaku_lag_s, session_danmaku_view, session_has_danmaku

    now = datetime.now(UTC)
    with get_session() as db:
        db.add(LiveRoom(id=1, room_id=123, input_url="123"))
        db.add(RecordingSession(id=1, room_id=1))
        db.add(Danmaku(session_id=1, room_id=1, ts=now, content="无法证明采集覆盖"))
    assert not session_has_danmaku(1)
    assert session_danmaku_lag_s(1) == 0
    assert session_danmaku_view(1) == {"state": "unavailable", "available": False, "ended_at": None}


@pytest.mark.parametrize("change", [{"version": 0}, {"version": True}, {"old_field": True}, {"summary": None}])
def test_refinement_only_accepts_current_record(change: dict[str, object]) -> None:
    from app.analysis.transcription.content import transcript_text
    from app.db.entities import Transcript

    current = {"version": 1, "applied": True, "clean_text": "整理正文", "summary": "摘要"}
    transcript = Transcript(segment_id=1, final_text="原始转写")
    transcript.auxiliary_json = json.dumps({"transcript_refinement": current})
    assert transcript_text(transcript) == "整理正文"
    transcript.auxiliary_json = json.dumps({"transcript_refinement": current | change})
    assert transcript_text(transcript) == "原始转写"


def test_invalid_journal_encoding_does_not_hide_current_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.publishing import journal

    monkeypatch.setattr(journal, "_JOURNAL_DIR", tmp_path)
    (tmp_path / "publish_journal_broken.json").write_bytes(b"\xff")
    assert journal.write_remote_success("current", 1, 1, 1, "BV1")
    assert [entry["attempt_token"] for entry in journal.read_pending_entries()] == ["current"]
    assert journal.mark_replayed("current", 1)
    assert (tmp_path / "publish_journal_broken.json").read_bytes() == b"\xff"
