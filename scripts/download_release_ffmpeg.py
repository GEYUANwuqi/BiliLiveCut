#!/usr/bin/env python3
"""为 CI 和 GitHub Release 下载并校验 Windows FFmpeg 静态构建。"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections.abc import Callable, Sequence
from pathlib import Path, PurePosixPath

PRIMARY_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
FALLBACK_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
DEFAULT_URLS = (PRIMARY_URL, FALLBACK_URL)
DEFAULT_ATTEMPTS = 3
DEFAULT_BACKOFF_S = 2.0
DEFAULT_TIMEOUT_S = 90.0
REQUIRED_BINARIES = ("ffmpeg.exe", "ffprobe.exe")
DOWNLOAD_CHUNK_SIZE = 1024 * 1024

DownloadFunction = Callable[[str, Path, float], None]
SleepFunction = Callable[[float], None]


def export_ci_environment(output_dir: Path, environment_file: Path) -> None:
    """验证真实二进制及必需滤镜，全部通过后才为后续 CI 步骤导出路径。"""
    binaries = {name: (output_dir / name).resolve() for name in REQUIRED_BINARIES}
    probes = [([str(path), "-hide_banner", "-version"], name) for name, path in binaries.items()]
    probes.append(([str(binaries["ffmpeg.exe"]), "-hide_banner", "-filters"], "FFmpeg filters"))
    filters: set[str] = set()
    for command, label in probes:
        try:
            result = subprocess.run(command, capture_output=True, text=True, errors="replace", timeout=30, check=True)
        except (OSError, subprocess.SubprocessError) as exc:
            detail = getattr(exc, "stderr", None) or getattr(exc, "stdout", None) or str(exc)
            status = f"exit={exc.returncode}" if isinstance(exc, subprocess.CalledProcessError) else ""
            if isinstance(exc, subprocess.TimeoutExpired):
                status = f"timeout={exc.timeout}s"
            raise RuntimeError(f"{label} 验证失败: {type(exc).__name__} {status}: {str(detail)[-2000:]}") from exc
        if label == "FFmpeg filters":
            filters = {parts[1] for line in result.stdout.splitlines() if len(parts := line.split()) >= 2}
        else:
            version_lines = result.stdout.strip().splitlines()
            if not version_lines:
                raise RuntimeError(f"{label} 版本探测没有输出")
            print(version_lines[0], flush=True)
    missing = {"subtitles", "drawtext"} - filters
    if missing:
        raise RuntimeError(f"FFmpeg 缺少 CI 必需滤镜: {', '.join(sorted(missing))}")
    lines = [f"FFMPEG_PATH={binaries['ffmpeg.exe']}", f"FFPROBE_PATH={binaries['ffprobe.exe']}"]
    if any("\n" in line or "\r" in line for line in lines):
        raise ValueError("FFmpeg 路径不能包含换行")
    with environment_file.open("a", encoding="utf-8") as output:
        output.write("\n".join(lines) + "\n")
    print(f"FFmpeg/FFprobe 可运行，字幕与文字滤镜齐全，CI 路径已导出: {output_dir.resolve()}", flush=True)


def _configure_console_encoding() -> None:
    """在宿主支持时将输出切换为 UTF-8，避免旧版 Windows 代码页无法输出中文。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace")
        except (OSError, TypeError, ValueError):
            continue


def _download_archive(url: str, destination: Path, timeout_s: float) -> None:
    """把单个候选 URL 流式下载到临时文件。"""
    request = urllib.request.Request(  # noqa: S310 - URL 固定在受审计的发布脚本中
        url,
        headers={"User-Agent": "BiliLiveCut-release-builder"},
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response, destination.open("wb") as output:  # noqa: S310
        shutil.copyfileobj(response, output, length=DOWNLOAD_CHUNK_SIZE)
    if destination.stat().st_size <= 0:
        raise RuntimeError("下载结果为空文件")


def _required_members(package: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    """定位 ZIP 中唯一的 FFmpeg/FFprobe 可执行文件。"""
    matches: dict[str, list[zipfile.ZipInfo]] = {name: [] for name in REQUIRED_BINARIES}
    for member in package.infolist():
        normalized = member.filename.replace("\\", "/")
        parts = PurePosixPath(normalized).parts
        if member.is_dir() or not parts:
            continue
        if normalized.startswith("/") or ".." in parts or parts[0].endswith(":"):
            raise RuntimeError(f"FFmpeg ZIP 包含不安全路径: {member.filename}")
        name = parts[-1].lower()
        if len(parts) >= 2 and parts[-2].lower() == "bin" and name in matches:
            matches[name].append(member)

    resolved: dict[str, zipfile.ZipInfo] = {}
    for name, candidates in matches.items():
        if len(candidates) != 1:
            raise RuntimeError(f"FFmpeg ZIP 中 {name} 数量异常: {len(candidates)}")
        if candidates[0].file_size <= 0:
            raise RuntimeError(f"FFmpeg ZIP 中 {name} 为空文件")
        resolved[name] = candidates[0]
    return resolved


def _verify_and_extract(archive_path: Path, output_dir: Path) -> None:
    """完整校验 ZIP，并把两个必需文件安全提取到目标目录。"""
    staging_dir = archive_path.parent / "staged"
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir()

    with zipfile.ZipFile(archive_path) as package:
        corrupt_member = package.testzip()
        if corrupt_member is not None:
            raise RuntimeError(f"FFmpeg ZIP CRC 校验失败: {corrupt_member}")
        members = _required_members(package)
        for name in REQUIRED_BINARIES:
            destination = staging_dir / name
            with package.open(members[name]) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output, length=DOWNLOAD_CHUNK_SIZE)

    output_dir.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_BINARIES:
        staged = staging_dir / name
        if staged.stat().st_size <= 0:
            raise RuntimeError(f"提取后的 {name} 为空文件")
        staged.replace(output_dir / name)


def download_release_ffmpeg(
    output_dir: Path,
    *,
    urls: Sequence[str] = DEFAULT_URLS,
    attempts: int = DEFAULT_ATTEMPTS,
    backoff_s: float = DEFAULT_BACKOFF_S,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    download: DownloadFunction | None = None,
    sleep: SleepFunction = time.sleep,
) -> str:
    """按来源重试下载 FFmpeg，并返回最终成功的 URL。"""
    if attempts < 1:
        raise ValueError("attempts 必须至少为 1")
    if backoff_s < 0 or timeout_s <= 0:
        raise ValueError("backoff_s 必须非负且 timeout_s 必须为正数")
    if not urls:
        raise ValueError("至少需要一个 FFmpeg 下载源")

    downloader = download or _download_archive
    output_parent = output_dir.resolve().parent
    output_parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    last_error: Exception | None = None

    with tempfile.TemporaryDirectory(prefix="blc-release-ffmpeg-", dir=output_parent) as temp_dir:
        archive_path = Path(temp_dir) / "ffmpeg.zip"
        for url in urls:
            for attempt in range(1, attempts + 1):
                archive_path.unlink(missing_ok=True)
                print(f"FFmpeg 下载: source={url} attempt={attempt}/{attempts}", flush=True)
                try:
                    downloader(url, archive_path, timeout_s)
                    _verify_and_extract(archive_path, output_dir)
                except (EOFError, OSError, RuntimeError, shutil.Error, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
                    last_error = exc
                    errors.append(f"{url} attempt {attempt}/{attempts}: {type(exc).__name__}: {exc}")
                    if attempt < attempts:
                        delay = backoff_s * (2 ** (attempt - 1))
                        print(f"FFmpeg 下载失败，{delay:.1f}s 后重试: {exc}", file=sys.stderr, flush=True)
                        sleep(delay)
                    continue
                print(f"FFmpeg 下载与校验完成: source={url} output={output_dir}", flush=True)
                return url

    detail = "\n".join(errors)
    raise RuntimeError(f"所有 FFmpeg 下载源均失败:\n{detail}") from last_error


def _positive_int(value: str) -> int:
    """解析正整数命令行参数。"""
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("必须至少为 1")
    return parsed


def _non_negative_float(value: str) -> float:
    """解析非负浮点命令行参数。"""
    parsed = float(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("不得小于 0")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    """创建 Release FFmpeg 下载器参数解析器。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True, help="ffmpeg.exe/ffprobe.exe 输出目录")
    parser.add_argument("--github-env", type=Path, help="验证二进制与滤镜后写入 GitHub Actions 环境文件")
    parser.add_argument("--attempts", type=_positive_int, default=DEFAULT_ATTEMPTS, help="每个来源的最大尝试次数")
    parser.add_argument(
        "--backoff-seconds",
        type=_non_negative_float,
        default=DEFAULT_BACKOFF_S,
        help="重试的初始退避秒数",
    )
    parser.add_argument("--timeout-seconds", type=float, default=DEFAULT_TIMEOUT_S, help="单次请求超时秒数")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """运行命令行下载器。"""
    _configure_console_encoding()
    args = build_parser().parse_args(argv)
    if args.timeout_seconds <= 0:
        print("ERROR: --timeout-seconds 必须为正数", file=sys.stderr)
        return 2
    print("::group::Downloading FFmpeg")
    try:
        download_release_ffmpeg(
            args.output_dir,
            attempts=args.attempts,
            backoff_s=args.backoff_seconds,
            timeout_s=args.timeout_seconds,
        )
        if args.github_env is not None:
            export_ci_environment(args.output_dir, args.github_env)
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        print("::endgroup::")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
