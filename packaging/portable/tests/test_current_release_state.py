"""拒绝旧发行的安装及续传记录，保留当前版本完整验证。"""

import json
import sys
from pathlib import Path

import pytest

_PORTABLE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PORTABLE_DIR / "src"))
sys.path.insert(0, str(_PORTABLE_DIR / "config"))

from blc_portable.payload.manifest import RELEASE_VERSION, SOURCE_COMMIT_FULL, SOURCE_COMMIT_SHORT


@pytest.mark.parametrize("change", ["missing", "release_version", "source_commit", "model_definitions_sha256"])
def test_download_cache_requires_current_identity(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, change: str) -> None:
    from blc_portable.engine_pack import builder, downloader
    from model_catalog import load_engines

    cache = tmp_path / ".model_cache"
    cache.mkdir()
    monkeypatch.setattr(builder, "PORTABLE_DIR", tmp_path)
    identity = downloader._state_identity()
    state = {"identity": identity, "downloaded": [e.engine_id for e in load_engines()], "progress": {}}
    if change == "missing":
        state.pop("identity")
    else:
        identity[change] = "old"
    path = cache / "download_state.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    assert downloader.load_state(path)["downloaded"] == []
    staging = tmp_path / "staging"
    with pytest.raises(ValueError, match="当前发行版本"):
        builder.copy_from_cache(staging)
    assert not staging.exists()


def test_current_download_state_is_reusable(tmp_path: Path) -> None:
    from blc_portable.engine_pack import downloader

    state = {"identity": downloader._state_identity(), "downloaded": ["whisper"], "progress": {}}
    path = tmp_path / "download_state.json"
    path.write_text(json.dumps(state), encoding="utf-8")
    assert downloader.load_state(path) == state


@pytest.mark.parametrize(
    "field,value", [("release_version", "old"), ("source_commit", "0" * 40), ("release_version", None)]
)
def test_completed_staging_requires_current_release(tmp_path: Path, field: str, value: str | None) -> None:
    from blc_portable.launcher.model_downloader import _staging_complete

    marker = tmp_path / ".provision-complete.json"
    data = {"release_version": RELEASE_VERSION, "source_commit": SOURCE_COMMIT_FULL, "content_fingerprint": "a" * 64}
    marker.write_text(json.dumps(data), encoding="utf-8")
    assert _staging_complete(tmp_path, marker, "a" * 64, {"required_files": []})
    if value is None:
        data.pop(field)
    else:
        data[field] = value
    marker.write_text(json.dumps(data), encoding="utf-8")
    assert not _staging_complete(tmp_path, marker, "a" * 64, {"required_files": []})


@pytest.mark.parametrize("field,value", [("release_version", "old"), ("source_commit", "0" * 40)])
def test_runtime_entrypoints_reject_old_release(tmp_path: Path, field: str, value: str) -> None:
    from blc_portable.runtime import get_current_release_dir
    from blc_portable.runtime.activation import read_current_json, write_current_json
    from blc_portable.runtime.verifier import verify_runtime

    write_current_json(
        tmp_path, "current", RELEASE_VERSION, SOURCE_COMMIT_FULL, SOURCE_COMMIT_SHORT, "a" * 40, "b" * 64, "c" * 64
    )
    assert read_current_json(tmp_path) is not None
    path = tmp_path / "runtime/current.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data[field] = value
    path.write_text(json.dumps(data), encoding="utf-8")
    assert read_current_json(tmp_path) is None
    assert get_current_release_dir(tmp_path) is None
    ok, errors = verify_runtime(tmp_path)
    assert not ok and errors
