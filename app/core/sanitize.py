"""敏感信息脱敏工具。

对日志/__repr__/错误消息中的 Cookie、API Key、密码等敏感字段进行掩码处理,
防止通过日志或 Web 界面意外泄露凭据。
"""

from __future__ import annotations

import re
import subprocess
import traceback
from collections.abc import Iterable
from urllib.parse import urlsplit

from sqlalchemy.exc import StatementError

# ── 脱敏模式 ──────────────────────────────────────────────────────

_COOKIE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(SESSDATA=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(bili_jct=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(DedeUserID=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(buvid3=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(buvid4=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(dedeuserid_ckmd5=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
    (re.compile(r"(sid=)[^;]*(;?)", re.IGNORECASE), r"\1***\2"),
]

_API_KEY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # key=... 或 KEY=... 或 api_key=... 等
    (re.compile(r"(\b(?:api[_-]?key|apikey|key)\s*=\s*)(\S+)", re.IGNORECASE), r"\1***"),
    # sk-... (OpenAI 风格的 API key)
    (re.compile(r"\b(?:sk-|hf_)[a-zA-Z0-9_-]{4,}"), "<redacted-key>"),
    # Bearer token / Authorization header
    (re.compile(r"(Authorization:\s*Bearer\s+)(\S+)", re.IGNORECASE), r"\1***"),
    (re.compile(r"(Authorization:\s*Basic\s+)(\S+)", re.IGNORECASE), r"\1***"),
]

_PASSWORD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(\b(?:password|passwd|pwd|secret)\s*[:=]\s*)(\S+)", re.IGNORECASE), r"\1***"),
    (re.compile(r"(--(?:password|passwd|pwd|secret)\s+)(\S+)", re.IGNORECASE), r"\1***"),
]

_URL_TOKEN_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # token=<value> in URL query strings
    (re.compile(r"([?&](?:token|access_token|auth|auth_token)\s*=\s*)([^&\s]+)", re.IGNORECASE), r"\1***"),
    # access_key=<value> in URLs
    (re.compile(r"([?&](?:access_key|secret_key)\s*=\s*)([^&\s]+)", re.IGNORECASE), r"\1***"),
]


def sanitize_text(text: str) -> str:
    """对文本中的敏感信息进行脱敏处理。

    检测并掩码以下类型的敏感数据:

    * Cookie 值 (SESSDATA, bili_jct, DedeUserID 等)
    * API Key (key=..., sk-..., Authorization 头)
    * 密码字段 (password, passwd, pwd, secret)
    * URL 中的 token/access_key 参数

    :param text: 原始文本。
    :returns: 脱敏后的文本。
    """
    if not text:
        return text

    result = text

    for pattern, replacement in _COOKIE_PATTERNS:
        result = pattern.sub(replacement, result)

    for pattern, replacement in _API_KEY_PATTERNS:
        result = pattern.sub(replacement, result)

    for pattern, replacement in _PASSWORD_PATTERNS:
        result = pattern.sub(replacement, result)

    for pattern, replacement in _URL_TOKEN_PATTERNS:
        result = pattern.sub(replacement, result)

    return result


def sanitize_cookie(cookie_string: str) -> str:
    """专门对 Bilibili Cookie 字符串进行脱敏。

    保留 cookie key 名称, 仅掩码 value 部分。未识别的 cookie 键也进行通用掩码。

    :param cookie_string: 原始 Cookie 字符串 (如 ``key1=val1; key2=val2``)。
    :returns: 脱敏后的 Cookie 字符串。
    """
    if not cookie_string:
        return cookie_string
    parts = cookie_string.split(";")
    sanitized_parts = []
    for part in parts:
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            sanitized_parts.append(f"{key.strip()}=***")
        else:
            sanitized_parts.append(part)
    return "; ".join(sanitized_parts)


def sanitize_diagnostic(text: str, *, secrets: Iterable[str] = (), limit: int = 2048) -> str:
    """对诊断先脱敏后限长；URL 仅保留主机，不保存路径、请求头或播放凭据。"""
    for secret in sorted(set(secrets), key=len, reverse=True):
        if secret:
            text = text.replace(secret, "<redacted>")

    def host_only(match: re.Match[str]) -> str:
        try:
            host = urlsplit(match[0]).hostname
        except ValueError:
            host = None
        return f"<host:{host or 'unknown'}>"

    text = re.sub(r"(?i)\b(?:https?|wss?|rtmps?|socks5h?)://[^\s<>\"']+", host_only, text)
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
    return sanitize_text(text)[:limit]


def safe_exception_summary(error: BaseException, *, limit: int = 2048) -> str:
    """保留异常类型和因果链；外部命令只显示退出信息及脱敏输出，不显示参数。"""
    parts: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(parts) < 8:
        seen.add(id(current))
        if isinstance(current, (subprocess.CalledProcessError, subprocess.TimeoutExpired)):
            if isinstance(current, subprocess.TimeoutExpired):
                detail = f"timeout={current.timeout}s"
            else:
                detail = f"exit_code={current.returncode}"
            output = current.stderr or current.stdout
            if output:
                if isinstance(output, bytes):
                    output = output.decode("utf-8", errors="replace")
                # 先脱敏再取尾部，FFmpeg/pip 的最终原因通常在输出末尾。
                detail += ": " + sanitize_diagnostic(output, limit=len(output))[-600:]
        elif isinstance(current, StatementError):
            # SQLAlchemy 的 str() 含 SQL 绑定参数，可能是用户配置/凭据。
            detail = safe_exception_summary(current.orig) if current.orig is not None else "数据库语句执行失败"
        else:
            detail = str(current)
        notes = "\n".join(getattr(current, "__notes__", ()))
        if notes:
            detail += "\n" + notes
        parts.append(f"{type(current).__name__}: {sanitize_diagnostic(detail, limit=800)}")
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    # 为每层分配空间，长包装信息不能挤掉最深根因。
    budget = max(40, (limit - max(0, len(parts) - 1) * 12) // max(1, len(parts)))
    parts = [part if len(part) <= budget else part[: budget - 1] + "…" for part in parts]
    return "\ncaused by: ".join(parts)[:limit]


def safe_exception_trace(error: BaseException, *, trusted_message: bool = True) -> str:
    """构造不含变量值/源码行的异常定位；不可信插件初始化错误只保留类型和栈。"""
    lines = [safe_exception_summary(error)] if trusted_message else []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        lines.append(type(current).__name__)
        lines.extend(
            f"  {frame.filename}:{frame.lineno} in {frame.name}"
            for frame in traceback.extract_tb(current.__traceback__)
        )
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    return sanitize_diagnostic("\n".join(lines), limit=16384)
