"""收件邮箱验证与发信许可，状态使用现有 AppSetting 持久化。"""

from __future__ import annotations

import hashlib
import json
import math
import secrets
import time
from dataclasses import asdict

from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db.entities import AppSetting
from app.db.session import get_session
from app.notify.mail import MailConfig, MailError, transmit

SMTP_KEYS = frozenset({"smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_password", "smtp_from", "smtp_to"})
_STATE_KEY = "mail:verification"
_DELIVERY_KEY = "mail:delivery"
_TTL = 600
_RESEND_INTERVAL = 60
_MAX_ATTEMPTS = 5


class VerificationError(ValueError):
    """邮箱验证失败或请求不满足限制。"""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class _Verification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fingerprint: str = ""
    challenge_id: str = ""
    digest: str = ""
    expires_at: float = 0
    attempts: int = 0
    delivered: bool = False
    verified_at: float | None = None
    send_times: list[float] = Field(default_factory=list)


def _load(db: Session) -> _Verification:
    row = db.get(AppSetting, _STATE_KEY)
    if row:
        try:
            return _Verification.model_validate_json(row.value)
        except ValidationError:
            logger.warning("邮箱验证状态无效，停止运行邮件直至重新验证")
    return _Verification()


def _save(db: Session, state: _Verification) -> None:
    row = db.get(AppSetting, _STATE_KEY) or AppSetting(key=_STATE_KEY)
    row.value = state.model_dump_json()
    db.add(row)


def invalidate_verification(db: Session) -> None:
    """与 SMTP 配置变更同事务撤销许可，切回旧配置也不能恢复旧验证。"""
    state = _load(db)
    state.fingerprint = state.digest = state.challenge_id = ""
    state.verified_at = None
    state.delivered = False
    _save(db, state)


def _configuration(db: Session) -> tuple[MailConfig, dict[str, object]]:
    keys = SMTP_KEYS | {"notify_enabled", "notify_on_connection", "notify_connection_cooldown_s"}
    baseline = get_settings()
    values = {key: getattr(baseline, key) for key in keys}
    for row in db.exec(select(AppSetting).where(AppSetting.key.in_(keys))).all():
        values[row.key] = json.loads(row.value) if isinstance(values[row.key], (bool, int)) else row.value
    return MailConfig(
        host=values["smtp_host"],
        port=values["smtp_port"],
        security=values["smtp_security"],
        user=values["smtp_user"],
        password=values["smtp_password"],
        sender=values["smtp_from"] or values["smtp_user"],
        recipient=values["smtp_to"],
    ), values


def _fingerprint(config: MailConfig) -> str:
    return hashlib.sha256(json.dumps(asdict(config), sort_keys=True).encode()).hexdigest()


def verification_status() -> dict[str, object]:
    """只返回状态、时间和已保存目标，不公开验证码、摘要或 SMTP 凭据。"""
    with get_session() as db:
        config, values = _configuration(db)
        state = _load(db)
        same = state.fingerprint == _fingerprint(config)
        now = time.time()
        verified = same and state.verified_at is not None
        delivery = db.get(AppSetting, _DELIVERY_KEY)
        return {
            "recipient": config.recipient,
            "verified": verified,
            "verified_at": state.verified_at if verified else None,
            "notifications_enabled": values["notify_enabled"],
            "can_notify": verified and bool(values["notify_enabled"]),
            "challenge_id": state.challenge_id if same and state.delivered and state.expires_at > now else None,
            "expires_in_s": max(0, int(state.expires_at - now)) if same and state.delivered else 0,
            "resend_after_s": max(0, math.ceil(state.send_times[-1] + _RESEND_INTERVAL - now))
            if state.send_times
            else 0,
            "attempts_remaining": max(0, _MAX_ATTEMPTS - state.attempts),
            "delivery": json.loads(delivery.value) if delivery else None,
        }


def request_verification() -> dict[str, object]:
    """仅显式请求验证码才发送验证邮件；SMTP 网络操作不占数据库事务。"""
    now = time.time()
    with get_session() as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        config, _ = _configuration(db)
        config.validate()
        state = _load(db)
        if state.verified_at is not None and state.fingerprint == _fingerprint(config):
            raise VerificationError("当前邮箱已验证，无需重复发送验证码", status_code=409)
        recent = [stamp for stamp in state.send_times if now - stamp < 3600]
        if recent and now - recent[-1] < _RESEND_INTERVAL:
            raise VerificationError("验证码发送过于频繁，请等待一分钟后重试", status_code=409)
        if len(recent) >= 5:
            raise VerificationError("一小时最多发送五次验证码，请稍后重试", status_code=409)
        code = f"{secrets.randbelow(1_000_000):06d}"
        challenge = secrets.token_urlsafe(24)
        state = _Verification(
            fingerprint=_fingerprint(config),
            challenge_id=challenge,
            digest=hashlib.sha256(f"{challenge}:{code}".encode()).hexdigest(),
            expires_at=now + _TTL,
            send_times=[*recent, now],
        )
        _save(db, state)
    transmit(
        config,
        "BiliLiveCut · 验证提醒邮箱",
        f"验证码：{code}\n\n验证码十分钟内有效，最多尝试五次。\n验证完成前，不会向此邮箱发送程序运行提醒。\n如非本人操作，请忽略。",
    )
    with get_session() as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        current, _ = _configuration(db)
        state = _load(db)
        if state.challenge_id != challenge or state.fingerprint != _fingerprint(current):
            raise VerificationError("邮件配置在发送期间发生变化，请重新发送验证码", status_code=409)
        state.delivered = True
        _save(db, state)
    return verification_status()


def confirm_verification(challenge_id: str, code: str) -> dict[str, object]:
    """在短写事务中核对并消耗验证码，失败次数也必须提交。"""
    error = None
    with get_session() as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        config, _ = _configuration(db)
        state = _load(db)
        if state.verified_at is not None:
            error = "验证码已使用，请读取最新验证状态"
        elif (
            not state.delivered
            or not state.digest
            or state.expires_at <= time.time()
            or state.fingerprint != _fingerprint(config)
            or state.challenge_id != challenge_id
        ):
            error = "验证码不存在、已过期或配置已变化，请重新发送"
        elif state.attempts >= _MAX_ATTEMPTS:
            error = "验证码尝试次数已用完，请重新发送"
        else:
            state.attempts += 1
            digest = hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest()
            if secrets.compare_digest(state.digest, digest):
                state.verified_at = time.time()
                state.digest = state.challenge_id = ""
                state.delivered = False
            else:
                error = "验证码错误" if state.attempts < _MAX_ATTEMPTS else "验证码尝试次数已用完，请重新发送"
            _save(db, state)
    if error:
        raise VerificationError(error)
    return verification_status()


def send_verified_email(subject: str, body: str, *, html: bool = False, alert_key: str | None = None) -> bool:
    """所有运行邮件共用验证闸门；连接告警按房间/类型持久去重。"""
    with get_session() as db:
        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        config, values = _configuration(db)
        state = _load(db)
        if not values["notify_enabled"] or state.verified_at is None or state.fingerprint != _fingerprint(config):
            return False
        if alert_key:
            if not values["notify_on_connection"]:
                return False
            key = "mail:alert:" + hashlib.sha256(alert_key.encode()).hexdigest()
            recent = db.get(AppSetting, key)
            now = time.time()
            if recent and now - float(recent.value) < values["notify_connection_cooldown_s"]:
                return False
            recent = recent or AppSetting(key=key)
            recent.value = str(now)
            db.add(recent)
    error = None
    try:
        transmit(config, subject, body, html=html)
    except MailError as exc:
        error = str(exc)
        logger.warning("邮件通知未送达：{}", error)
    with get_session() as db:
        row = db.get(AppSetting, _DELIVERY_KEY) or AppSetting(key=_DELIVERY_KEY)
        row.value = json.dumps({"at": time.time(), "ok": error is None, "error": error}, ensure_ascii=False)
        db.add(row)
    return error is None
