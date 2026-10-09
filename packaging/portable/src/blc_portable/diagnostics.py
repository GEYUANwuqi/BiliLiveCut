"""独立启动器和下载进程共享的纯标准库安全诊断。"""

from __future__ import annotations

import re
import subprocess
from urllib.parse import urlsplit


def redact_diagnostic(text: str, *, limit: int = 12000) -> str:
    """先删除 URL 路径/凭据及敏感头，再截取有界诊断，供独立启动器使用。"""
    text = re.sub(r"(?i)\b(?:https?|socks5h?)://[^\s<>\"']+", lambda m: safe_host(m[0]), text)
    text = re.sub(
        r"""(?i)(["']?\b(?:cookie|set-cookie|authorization|proxy-authorization|token|access_token|api[_-]?key|password|passwd|secret|signature|SESSDATA|bili_jct)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')""",
        r"\1<redacted>",
        text,
    )
    text = re.sub(
        r"(?im)\b(cookie|set-cookie|authorization|proxy-authorization)\s*[:=][^\r\n]*",
        r"\1: <redacted>",
        text,
    )
    text = re.sub(
        r"(?i)\b(token|access_token|api[_-]?key|password|passwd|secret|signature)\s*[:=]\s*[^\s,;]+",
        r"\1=<redacted>",
        text,
    )
    text = re.sub(r"\b(?:sk-|hf_)[a-zA-Z0-9_-]{4,}", "<redacted-key>", text)
    return text[-limit:]


def safe_host(value: str) -> str:
    """只记录端点的主机名，不输出签名 URL、用户信息、路径和查询参数。"""
    try:
        host = urlsplit(value).hostname
    except ValueError:
        host = None
    return f"<host:{host or 'unknown'}>"


def exception_summary(error: BaseException) -> str:
    """启动器异常链摘要；子进程参数可能携密钥，不直接格式化异常对象。"""
    parts: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(parts) < 8:
        seen.add(id(current))
        if isinstance(current, (subprocess.TimeoutExpired, subprocess.CalledProcessError)):
            detail = (
                f"timeout={current.timeout}s"
                if isinstance(current, subprocess.TimeoutExpired)
                else f"exit_code={current.returncode}"
            )
            output = current.stderr or current.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")
            detail += "\n" + redact_diagnostic(output, limit=1500)
        else:
            detail = str(current)
        parts.append(f"{type(current).__name__}: {redact_diagnostic(detail, limit=1500)}")
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    return "\ncaused by: ".join(parts)
