"""Release FFmpeg 下载器的离线回归测试。"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
import urllib.error
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
import yaml

from scripts import download_release_ffmpeg

if TYPE_CHECKING:
    from pytest import MonkeyPatch


def _build_ffmpeg_fixture(path: Path) -> None:
    """创建同时兼容 BtbN/Gyan 目录结构的最小 ZIP。"""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("ffmpeg-fixture/bin/ffmpeg.exe", b"ffmpeg-binary")
        package.writestr("ffmpeg-fixture/bin/ffprobe.exe", b"ffprobe-binary")


def test_download_retries_primary_then_validates_and_uses_fallback(tmp_path: Path) -> None:
    """主源持续 504、备用源首包损坏时仍应重试并只落盘完整文件。"""
    fixture = tmp_path / "fixture.zip"
    output_dir = tmp_path / "bin"
    _build_ffmpeg_fixture(fixture)
    calls: list[tuple[str, float]] = []
    sleeps: list[float] = []
    per_url_attempts: dict[str, int] = {}

    def fake_download(url: str, destination: Path, timeout_s: float) -> None:
        calls.append((url, timeout_s))
        per_url_attempts[url] = per_url_attempts.get(url, 0) + 1
        if url == "primary":
            raise urllib.error.HTTPError(url, 504, "Gateway Timeout", None, None)
        if per_url_attempts[url] == 1:
            destination.write_bytes(b"not-a-zip")
            return
        shutil.copyfile(fixture, destination)

    selected = download_release_ffmpeg.download_release_ffmpeg(
        output_dir,
        urls=("primary", "fallback"),
        attempts=2,
        backoff_s=0.25,
        timeout_s=12.0,
        download=fake_download,
        sleep=sleeps.append,
    )

    assert selected == "fallback"
    assert calls == [
        ("primary", 12.0),
        ("primary", 12.0),
        ("fallback", 12.0),
        ("fallback", 12.0),
    ]
    assert sleeps == [0.25, 0.25]
    assert (output_dir / "ffmpeg.exe").read_bytes() == b"ffmpeg-binary"
    assert (output_dir / "ffprobe.exe").read_bytes() == b"ffprobe-binary"


def test_download_fails_closed_without_partial_binaries(tmp_path: Path) -> None:
    """全部来源失败时必须聚合错误，且不得留下伪造可执行文件。"""
    output_dir = tmp_path / "bin"

    def fail_download(url: str, destination: Path, timeout_s: float) -> None:
        del destination, timeout_s
        raise OSError(f"unavailable: {url}")

    with pytest.raises(RuntimeError, match="所有 FFmpeg 下载源均失败") as error:
        download_release_ffmpeg.download_release_ffmpeg(
            output_dir,
            urls=("primary", "fallback"),
            attempts=1,
            download=fail_download,
            sleep=lambda _delay: None,
        )

    assert "primary attempt 1/1" in str(error.value)
    assert "fallback attempt 1/1" in str(error.value)
    assert not output_dir.exists()


def test_main_reconfigures_narrow_windows_console_before_logging(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
) -> None:
    """CP1252 控制台也必须能输出下载器的中文日志。"""
    fixture = tmp_path / "fixture.zip"
    output_dir = tmp_path / "bin"
    _build_ffmpeg_fixture(fixture)
    stdout_bytes = io.BytesIO()
    stderr_bytes = io.BytesIO()
    stdout = io.TextIOWrapper(stdout_bytes, encoding="cp1252", errors="strict")
    stderr = io.TextIOWrapper(stderr_bytes, encoding="cp1252", errors="strict")

    def fake_download(url: str, destination: Path, timeout_s: float) -> None:
        del url, timeout_s
        shutil.copyfile(fixture, destination)

    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", stderr)
    monkeypatch.setattr(download_release_ffmpeg, "_download_archive", fake_download)

    exit_code = download_release_ffmpeg.main(["--output-dir", str(output_dir), "--attempts", "1"])
    stdout.flush()
    stderr.flush()

    assert exit_code == 0
    assert stdout.encoding.lower().replace("_", "-") == "utf-8"
    assert stderr.encoding.lower().replace("_", "-") == "utf-8"
    assert "FFmpeg 下载与校验完成" in stdout_bytes.getvalue().decode("utf-8")


def test_release_workflow_uses_resilient_ffmpeg_downloader() -> None:
    """Release 工作流必须调用受测下载器并预留完整重试时间。"""
    repo_root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((repo_root / ".github/workflows/release.yml").read_text(encoding="utf-8"))
    steps = workflow["jobs"]["build-windows-lite"]["steps"]
    step = next(item for item in steps if item.get("name") == "Download FFmpeg static binaries")

    assert step["run"] == "python scripts/download_release_ffmpeg.py --output-dir bin"
    assert step["timeout-minutes"] >= 10


def test_ci_exports_verified_absolute_binary_paths(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    binary_dir = tmp_path / "ffmpeg bin"
    environment_file = tmp_path / "github-env"
    environment_file.write_text("EXISTING=value\n", encoding="utf-8")
    commands: list[list[str]] = []

    def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert kwargs["check"] is True
        assert kwargs["timeout"] == 30
        commands.append(command)
        output = (
            " ... subtitles V->V\n T.C drawtext V->V\n" if command[-1] == "-filters" else "FFmpeg version fixture\n"
        )
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

    monkeypatch.setattr(download_release_ffmpeg.subprocess, "run", run)
    download_release_ffmpeg.export_ci_environment(binary_dir, environment_file)

    assert commands == [
        [str((binary_dir / "ffmpeg.exe").resolve()), "-hide_banner", "-version"],
        [str((binary_dir / "ffprobe.exe").resolve()), "-hide_banner", "-version"],
        [str((binary_dir / "ffmpeg.exe").resolve()), "-hide_banner", "-filters"],
    ]
    assert environment_file.read_text(encoding="utf-8") == (
        f"EXISTING=value\nFFMPEG_PATH={(binary_dir / 'ffmpeg.exe').resolve()}\n"
        f"FFPROBE_PATH={(binary_dir / 'ffprobe.exe').resolve()}\n"
    )


@pytest.mark.parametrize("failure_stage", ["ffmpeg.exe", "ffprobe.exe", "filters", "timeout", "missing"])
def test_ci_probe_failure_preserves_cause_without_exporting_paths(
    tmp_path: Path, monkeypatch: MonkeyPatch, failure_stage: str
) -> None:
    environment_file = tmp_path / "github-env"
    environment_file.write_text("EXISTING=value\n", encoding="utf-8")

    def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        stage = "filters" if command[-1] == "-filters" else Path(command[0]).name
        if failure_stage == "timeout":
            raise subprocess.TimeoutExpired(command, 30, stderr="probe hung")
        if failure_stage == "missing":
            raise FileNotFoundError("binary missing")
        if stage == failure_stage:
            raise subprocess.CalledProcessError(7, command, stderr="invalid executable")
        return subprocess.CompletedProcess(command, 0, stdout="version fixture\n", stderr="")

    monkeypatch.setattr(download_release_ffmpeg.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="验证失败") as caught:
        download_release_ffmpeg.export_ci_environment(tmp_path / "bin", environment_file)
    assert isinstance(caught.value.__cause__, (OSError, subprocess.SubprocessError))
    assert environment_file.read_text(encoding="utf-8") == "EXISTING=value\n"


@pytest.mark.parametrize(
    "filters",
    [
        " ... subtitles V->V\n",
        " ... drawtext V->V\n",
        " ... subtitles V->V\n ... drawtext_extra V->V\n",
        " ... subtitles_extra V->V\n ... drawtext V->V\n",
    ],
)
def test_ci_requires_exact_subtitle_and_text_filter_names(
    tmp_path: Path, monkeypatch: MonkeyPatch, filters: str
) -> None:
    environment_file = tmp_path / "github-env"

    def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        output = filters if command[-1] == "-filters" else "version fixture\n"
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

    monkeypatch.setattr(download_release_ffmpeg.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="缺少 CI 必需滤镜"):
        download_release_ffmpeg.export_ci_environment(tmp_path / "bin", environment_file)
    assert not environment_file.exists()


def test_failed_download_returns_nonzero_without_ci_export(
    tmp_path: Path, monkeypatch: MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    calls: list[str] = []

    def fail(url: str, destination: Path, timeout_s: float) -> None:
        calls.append(url)
        raise urllib.error.HTTPError(url, 504, "Gateway Timeout", None, None)

    monkeypatch.setattr(download_release_ffmpeg, "_download_archive", fail)
    environment_file = tmp_path / "github-env"
    result = download_release_ffmpeg.main(
        ["--output-dir", str(tmp_path / "bin"), "--attempts", "1", "--github-env", str(environment_file)]
    )
    assert result == 1
    assert calls == list(download_release_ffmpeg.DEFAULT_URLS)
    assert not environment_file.exists()
    error = capsys.readouterr().err
    assert "HTTPError: HTTP Error 504" in error
    assert all(url in error for url in calls)


def test_main_verifies_download_before_exporting_ci_environment(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    fixture = tmp_path / "fixture.zip"
    _build_ffmpeg_fixture(fixture)

    def download(url: str, destination: Path, timeout_s: float) -> None:
        shutil.copyfile(fixture, destination)

    def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert Path(command[0]).is_file()
        output = " ... subtitles V->V\n ... drawtext V->V\n" if command[-1] == "-filters" else "version fixture\n"
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

    monkeypatch.setattr(download_release_ffmpeg, "_download_archive", download)
    monkeypatch.setattr(download_release_ffmpeg.subprocess, "run", run)
    environment_file = tmp_path / "github-env"
    output_dir = tmp_path / "bin"
    assert download_release_ffmpeg.main(["--output-dir", str(output_dir), "--github-env", str(environment_file)]) == 0
    assert f"FFPROBE_PATH={(output_dir / 'ffprobe.exe').resolve()}" in environment_file.read_text(encoding="utf-8")


def test_windows_ci_uses_verified_ffmpeg_download() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((repo_root / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    steps = workflow["jobs"]["test"]["steps"]
    step = next(item for item in steps if item.get("name") == "Install FFmpeg (Windows)")

    assert step["run"].splitlines() == [
        'python scripts/download_release_ffmpeg.py --output-dir "$env:RUNNER_TEMP/ffmpeg/bin" '
        '--github-env "$env:GITHUB_ENV"',
        'if ($LASTEXITCODE -ne 0) { throw "FFmpeg provisioning or validation failed" }',
        '"$env:RUNNER_TEMP/ffmpeg/bin" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append',
    ]
    assert step["timeout-minutes"] == 15
    assert step["shell"] == "pwsh"
